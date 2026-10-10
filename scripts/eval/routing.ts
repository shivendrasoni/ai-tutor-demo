/** Scores each available Decider against labelled messages. Usage: pnpm eval:routing --set evals/routing.jsonl (needs real providers). */
import '../env';
import { z } from 'zod';
import type { Decider, DeciderAnswer } from '@/modules/tutor/decider/types';
import { buildQuestions, chapterQuestion, needsChapterCall, THRESHOLDS, topSubjectsForChapters } from '@/modules/tutor/routing';
import { accuracyByBand, isEntry, loadActors, parseJsonl, renderReport, requireEnv, setArg, writeReport, type Band } from './lib';

export const routingCaseSchema = z.object({
  message: z.string().min(1),
  studentUsername: z.string().min(1),
  /** Subject name, or "none" when the message fits no subject. */
  subject: z.string().min(1),
  chapterTitle: z.string().min(1).optional(),
  intent: z.string().min(1),
  difficulty: z.enum(['recall', 'apply', 'multi_step']),
  outOfSyllabus: z.boolean(),
});
export type RoutingCase = z.infer<typeof routingCaseSchema>;

export type RoutingCtx = {
  grade: number;
  subjects: { id: string; name: string }[];
  /** Chapters per subject id. */
  chapters: Record<string, { id: string; title: string }[]>;
};

const FIELDS = ['intent', 'subject', 'chapter', 'difficulty', 'outOfSyllabus'] as const;
type Field = (typeof FIELDS)[number];
type Scored = { confidence: number; correct: boolean };
const LEVELS = ['recall', 'apply', 'multi_step'];

export type RoutingResult = {
  name: string;
  n: number;
  fields: Record<Field, { n: number; accuracy: number | null }>;
  byBand: Record<Field, Record<Band, { n: number; accuracy: number | null }>>;
};

/** Asks the decider the same questions `runTurn` builds (message only as state) and scores the answers against the labels. */
async function score(c: RoutingCase, decider: Decider, ctx: RoutingCtx): Promise<Partial<Record<Field, Scored>>> {
  const state = `user: ${c.message}`;
  const questions = buildQuestions({ grade: ctx.grade, subjects: ctx.subjects });
  const subjectIds = ctx.subjects.map((s) => s.id);
  let answers: Record<string, DeciderAnswer> = {};
  try {
    answers = await decider.decide(state, questions);
    if (needsChapterCall(answers, subjectIds)) {
      const chapters = topSubjectsForChapters(answers, subjectIds).flatMap((id) => ctx.chapters[id] ?? []);
      if (chapters.length) answers = { ...answers, ...(await decider.decide(state, chapterQuestion(chapters))) };
    }
  } catch {
    answers = {}; // a failing decider scores as "no answer" everywhere
  }
  const out: Partial<Record<Field, Scored>> = {};
  const choice = (a: DeciderAnswer | undefined) => (a?.type === 'choice' ? a : undefined);

  const i = choice(answers.intent);
  out.intent = { confidence: i?.confidence ?? 0, correct: i?.choice === c.intent };

  const s = choice(answers.subject);
  const predictedSubject = s ? (s.choice === 'other' ? 'none' : ctx.subjects.find((x) => x.id === s.choice)?.name) : undefined;
  out.subject = { confidence: s?.confidence ?? 0, correct: predictedSubject === c.subject };

  if (c.chapterTitle) {
    const ch = choice(answers.chapter);
    const title = ch ? Object.values(ctx.chapters).flat().find((x) => x.id === ch.choice)?.title : undefined;
    out.chapter = { confidence: ch?.confidence ?? 0, correct: title === c.chapterTitle };
  }

  const d = answers.difficulty?.type === 'score' ? answers.difficulty : undefined;
  out.difficulty = { confidence: d?.confidence ?? 0, correct: d ? LEVELS[d.score] === c.difficulty : false };

  const o = answers.out_of_syllabus?.type === 'yesno' ? answers.out_of_syllabus : undefined;
  out.outOfSyllabus = {
    confidence: o ? Math.abs(2 * o.p - 1) : 0,
    correct: o ? o.p >= THRESHOLDS.outOfSyllabus === c.outOfSyllabus : false,
  };
  return out;
}

export async function runRoutingEval(
  cases: RoutingCase[],
  deciders: { name: string; decider: Decider }[],
  ctxFor: (c: RoutingCase) => Promise<RoutingCtx>,
): Promise<RoutingResult[]> {
  const results: RoutingResult[] = [];
  for (const { name, decider } of deciders) {
    const scored: Record<Field, Scored[]> = { intent: [], subject: [], chapter: [], difficulty: [], outOfSyllabus: [] };
    for (const c of cases) {
      const r = await score(c, decider, await ctxFor(c));
      for (const f of FIELDS) if (r[f]) scored[f].push(r[f]);
    }
    const byBand = Object.fromEntries(FIELDS.map((f) => [f, accuracyByBand(scored[f])])) as RoutingResult['byBand'];
    const fields = Object.fromEntries(
      FIELDS.map((f) => [f, { n: scored[f].length, accuracy: scored[f].length ? scored[f].filter((x) => x.correct).length / scored[f].length : null }]),
    ) as RoutingResult['fields'];
    results.push({ name, n: cases.length, fields, byBand });
  }
  return results;
}

async function main() {
  requireEnv('eval:routing', ['DATABASE_URL_APP', 'DATABASE_URL_OWNER']);
  if (!process.env.TYPESAFE_API_KEY && !process.env.LLM_STANDARD_MODEL) {
    console.error('eval:routing: set TYPESAFE_API_KEY (Jev) and/or LLM_STANDARD_MODEL (LLM decider); no Decider is available.');
    process.exit(1);
  }
  const { readFile } = await import('node:fs/promises');
  const { closeDb } = await import('@/db/client');
  const { listVisibleChapters, listVisibleSubjects, studentScope } = await import('@/modules/content');
  const { ModelRegistry } = await import('@/modules/tutor');
  const { JevDecider } = await import('@/modules/tutor/decider/jev');
  const { LlmDecider } = await import('@/modules/tutor/decider/llm');
  try {
    const cases = parseJsonl(await readFile(setArg('routing'), 'utf8'), routingCaseSchema);
    const actors = await loadActors(cases.map((c) => c.studentUsername));
    const deciders: { name: string; decider: Decider }[] = [];
    if (process.env.TYPESAFE_API_KEY) deciders.push({ name: 'jev', decider: new JevDecider({ apiKey: process.env.TYPESAFE_API_KEY }) });
    if (process.env.LLM_STANDARD_MODEL) {
      deciders.push({ name: 'llm', decider: new LlmDecider({ model: new ModelRegistry().resolve(process.env.LLM_STANDARD_MODEL) }) });
    }
    const cache = new Map<string, RoutingCtx>();
    const ctxFor = async (c: RoutingCase): Promise<RoutingCtx> => {
      const hit = cache.get(c.studentUsername);
      if (hit) return hit;
      const scope = await studentScope(actors[c.studentUsername]!);
      const subjects = await listVisibleSubjects(scope);
      const chapters: RoutingCtx['chapters'] = {};
      for (const s of subjects) chapters[s.id] = (await listVisibleChapters(scope, s.id)).map((x) => ({ id: x.id, title: x.title }));
      const ctx = { grade: scope.grade, subjects, chapters };
      cache.set(c.studentUsername, ctx);
      return ctx;
    };
    const results = await runRoutingEval(cases, deciders, ctxFor);
    const sections = results.flatMap((r) => [
      {
        title: `${r.name}: accuracy`,
        rows: FIELDS.map((f) => ({ field: f, n: r.fields[f].n, accuracy: r.fields[f].accuracy })),
      },
      {
        title: `${r.name}: accuracy per confidence band`,
        rows: FIELDS.flatMap((f) =>
          (['low', 'mid', 'high'] as const).map((b) => ({ field: f, band: b, n: r.byBand[f][b].n, accuracy: r.byBand[f][b].accuracy })),
        ),
      },
    ]);
    console.log(`Report: ${await writeReport('routing', renderReport('routing', sections, new Date()))}`);
  } finally {
    await closeDb();
  }
}

if (isEntry(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(`Error: ${(e as Error)?.message ?? String(e)}`);
      process.exit(1);
    },
  );
}
