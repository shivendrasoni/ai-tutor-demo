/** Retrieval hit rate and citation accuracy. Usage: pnpm eval:tutor --set evals/tutor/<book>.jsonl (needs real providers). */
import '../env';
import { z } from 'zod';
import type { Actor } from '@/modules/tenancy/actor';
import type { ChunkHit } from '@/modules/content';
import { citationAccuracy, isEntry, loadActors, parseJsonl, renderReport, requireEnv, retrievalHitRate, setArg, writeReport } from './lib';

export const tutorCaseSchema = z.object({
  question: z.string().min(1),
  studentUsername: z.string().min(1),
  expectedChapterTitle: z.string().min(1),
  expectedPages: z.tuple([z.number().int(), z.number().int()]),
});
export type TutorCase = z.infer<typeof tutorCaseSchema>;

export type TutorEvalDeps = {
  actors: Record<string, Actor>;
  /** Top-8 retrieval for the question, as the student. */
  search: (actor: Actor, question: string) => Promise<ChunkHit[]>;
  /** A full tutor turn; `citations` are the ones stored on the answer. */
  ask: (actor: Actor, question: string) => Promise<{ hits: ChunkHit[]; citations: { pageStart: number; pageEnd: number }[] }>;
};

export async function runTutorEval(cases: TutorCase[], deps: TutorEvalDeps) {
  const rows = [];
  for (const c of cases) {
    const actor = deps.actors[c.studentUsername];
    if (!actor) throw new Error(`no actor for student "${c.studentUsername}"`);
    const hits = await deps.search(actor, c.question);
    const { citations } = await deps.ask(actor, c.question);
    rows.push({ ...c, hits, citations });
  }
  return { n: rows.length, retrievalHitRate: retrievalHitRate(rows), citationAccuracy: citationAccuracy(rows), rows };
}

async function main() {
  requireEnv('eval:tutor', ['DATABASE_URL_APP', 'DATABASE_URL_OWNER', 'LLM_STANDARD_MODEL']);
  const { readFile } = await import('node:fs/promises');
  const { closeDb } = await import('@/db/client');
  const { studentScope, searchChunks } = await import('@/modules/content');
  const { createConversation, runTurn } = await import('@/modules/tutor');
  try {
    const cases = parseJsonl(await readFile(setArg('tutor'), 'utf8'), tutorCaseSchema);
    const actors = await loadActors(cases.map((c) => c.studentUsername));
    const r = await runTutorEval(cases, {
      actors,
      search: async (actor, q) => searchChunks(await studentScope(actor), q, { limit: 8 }),
      ask: async (actor, q) => {
        const { id } = await createConversation(actor, { skillKey: 'explain' });
        let citations: { pageStart: number; pageEnd: number }[] = [];
        for await (const e of runTurn(actor, id, q)) {
          if (e.type === 'citations') citations = e.data.citations;
          if (e.type === 'error') throw new Error(`${e.data.code}: ${e.data.message}`);
        }
        return { hits: [], citations };
      },
    });
    const md = renderReport(
      'tutor',
      [
        { title: 'Summary', rows: [{ cases: r.n, retrievalHitRate: r.retrievalHitRate, citationAccuracy: r.citationAccuracy }] },
        {
          title: 'Cases',
          rows: r.rows.map((x) => ({
            question: x.question,
            expectedChapter: x.expectedChapterTitle,
            retrievedChapters: x.hits.map((h) => h.chapterTitle).join(', '),
            expectedPages: x.expectedPages.join('-'),
            citedPages: x.citations.map((c) => `${c.pageStart}-${c.pageEnd}`).join(', '),
          })),
        },
      ],
      new Date(),
    );
    console.log(`Report: ${await writeReport('tutor', md)}`);
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
