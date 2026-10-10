import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { withTenant, type Tx } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { listVisibleChapters, listVisibleSubjects, studentScope } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { listSkills } from '@/modules/tutor';
import { now } from './clock';
import { SKILL_FOR_TYPE } from './llm';
import { defaultPatternKey, getPattern } from './patterns';
import { getStudyQueue } from './queue';
import type { ArtifactType, Sources } from './schemas';

export const DAILY_GENERATION_LIMIT = 10;
const MIN_CHAPTERS = 1;
const MAX_CHAPTERS = 6;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 30;
const DEFAULT_QUESTIONS = 10;
const TYPES: readonly ArtifactType[] = ['practice_test', 'mock_exam', 'study_notes', 'last_night_notes'];
const DAY_MS = 86_400_000;
export const GENERATING_STALE_MS = 15 * 60_000;

/** Lazy reaper: the student's own artifacts stuck `generating` (lost job, crash before enqueue) are marked failed. */
async function reapStaleGenerating(tx: Tx, studentId: string): Promise<void> {
  await tx
    .update(artifacts)
    .set({ status: 'failed', error: 'GENERATION_FAILED', content: null })
    .where(
      and(
        eq(artifacts.studentId, studentId),
        eq(artifacts.status, 'generating'),
        lt(artifacts.createdAt, new Date(now().getTime() - GENERATING_STALE_MS)),
      ),
    );
}

export type RequestArtifactInput = {
  type: ArtifactType;
  subjectId: string;
  chapterIds: string[];
  questionCount?: number;
  patternKey?: string;
};

export type Citation = { chunkId: string; itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number };
export type ViewQuestion = {
  id: string;
  type: string;
  prompt: string;
  options?: string[];
  marks: number;
  chapterId: string;
  citations: Citation[];
};
export type ViewSection = { key: string; title: string; questions: ViewQuestion[] };
export type ViewNote = { heading: string; bodyMarkdown: string; chapterId: string; citations: Citation[] };
export type ArtifactView = {
  id: string;
  type: ArtifactType;
  status: string;
  error: string | null;
  subjectId: string;
  chapterIds: string[];
  chapterTitles: Record<string, string>;
  params: { questionCount?: number; patternKey?: string };
  createdAt: Date;
  title: string | null;
  durationMinutes?: number;
  sections?: ViewSection[];
  questions?: ViewQuestion[];
  notes?: ViewNote[];
};
export type ArtifactSummary = {
  id: string;
  type: ArtifactType;
  status: string;
  subjectId: string;
  chapterIds: string[];
  title: string | null;
  createdAt: Date;
  attemptCount: number;
  bestScorePct: number | null;
};

const validation = (message: string): DomainError => new DomainError('VALIDATION', message);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Midnight UTC of the clock's current day. */
const utcDayStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function checkShape(input: RequestArtifactInput): void {
  if (!input || !TYPES.includes(input.type)) throw validation('Unknown artifact type');
  if (!Array.isArray(input.chapterIds)) throw validation('chapterIds must be a list');
  if (typeof input.subjectId !== 'string') throw validation('subjectId is required');
  if (input.questionCount !== undefined) {
    if (input.type !== 'practice_test') throw validation('questionCount is only for practice tests');
    if (!Number.isInteger(input.questionCount) || input.questionCount < MIN_QUESTIONS || input.questionCount > MAX_QUESTIONS) {
      throw validation(`questionCount must be a whole number from ${MIN_QUESTIONS} to ${MAX_QUESTIONS}`);
    }
  }
  if (input.patternKey !== undefined) {
    if (input.type !== 'mock_exam') throw validation('patternKey is only for mock exams');
    if (typeof input.patternKey !== 'string') throw validation('patternKey must be a string');
  }
}

export async function requestArtifact(actor: Actor, input: RequestArtifactInput): Promise<{ id: string }> {
  const scope = await studentScope(actor);
  checkShape(input);

  const chapterIds = [...new Set(input.chapterIds)];
  if (chapterIds.length < MIN_CHAPTERS || chapterIds.length > MAX_CHAPTERS) {
    throw validation(`Choose ${MIN_CHAPTERS} to ${MAX_CHAPTERS} chapters`);
  }
  if (!(await listVisibleSubjects(scope)).some((s) => s.id === input.subjectId)) throw validation('Subject is not available');
  const visible = new Map((await listVisibleChapters(scope, input.subjectId)).map((c) => [c.id, c.title]));
  const chapterTitles: Record<string, string> = {};
  for (const id of chapterIds) {
    const title = visible.get(id);
    if (title === undefined) throw validation('A chapter is not available for this subject');
    chapterTitles[id] = title;
  }

  const params: Record<string, unknown> = { chapterTitles };
  if (input.type === 'practice_test') params.questionCount = input.questionCount ?? DEFAULT_QUESTIONS;
  if (input.type === 'mock_exam') {
    const key = input.patternKey ?? defaultPatternKey(scope.grade);
    const pattern = await getPattern(key);
    if (!pattern || scope.grade < pattern.gradeMin || scope.grade > pattern.gradeMax) {
      throw validation('That exam pattern is not available for your grade');
    }
    params.patternKey = key;
  }

  const skill = (await listSkills()).find((s) => s.key === SKILL_FOR_TYPE[input.type]);
  if (!skill) throw new Error(`Study skill ${SKILL_FOR_TYPE[input.type]} is not seeded`);

  const at = now();
  const dayStart = utcDayStart(at);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const studentId = actor.userId;
  const created = await withTenant(scope.schoolId, async (tx) => {
    // Serializes this student's requests so the count and the insert are atomic with respect to each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${studentId}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(artifacts)
      .where(and(eq(artifacts.studentId, studentId), gte(artifacts.createdAt, dayStart), lt(artifacts.createdAt, dayEnd)));
    if (n >= DAILY_GENERATION_LIMIT) throw new DomainError('GENERATION_LIMIT', 'Daily generation limit reached');
    const [row] = await tx
      .insert(artifacts)
      .values({
        schoolId: scope.schoolId,
        studentId,
        skillId: skill.id,
        type: input.type,
        subjectId: input.subjectId,
        chapterIds,
        params,
        status: 'generating',
        createdAt: at,
      })
      .returning({ id: artifacts.id });
    return row!;
  });

  try {
    await getStudyQueue().enqueueGenerate({ artifactId: created.id, schoolId: scope.schoolId });
  } catch (e) {
    await withTenant(scope.schoolId, (tx) =>
      tx.update(artifacts).set({ status: 'failed', error: 'GENERATION_FAILED' }).where(eq(artifacts.id, created.id)),
    );
    throw e;
  }
  return { id: created.id };
}

// ---- views (whitelist mappers: only named fields are copied) ----

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const asArray = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function citationsOf(chunkIds: unknown, sources: Sources): Citation[] {
  const out: Citation[] = [];
  for (const chunkId of Array.isArray(chunkIds) ? (chunkIds as string[]) : []) {
    const s = sources[chunkId];
    if (s) out.push({ chunkId, itemTitle: s.itemTitle, chapterTitle: s.chapterTitle, pageStart: s.pageStart, pageEnd: s.pageEnd });
  }
  return out;
}

export const questionView = (q: Raw, sources: Sources): ViewQuestion => ({
  id: q.id,
  type: q.type,
  prompt: q.prompt,
  ...(Array.isArray(q.options) ? { options: q.options.map(String) } : {}),
  marks: q.marks,
  chapterId: q.chapterId,
  citations: citationsOf(q.chunkIds, sources),
});

export function toArtifactView(row: typeof artifacts.$inferSelect): ArtifactView {
  const params = (row.params ?? {}) as Raw;
  const view: ArtifactView = {
    id: row.id,
    type: row.type as ArtifactType,
    status: row.status,
    error: row.error,
    subjectId: row.subjectId,
    chapterIds: row.chapterIds,
    chapterTitles: { ...(params.chapterTitles ?? {}) },
    params: {
      ...(typeof params.questionCount === 'number' ? { questionCount: params.questionCount } : {}),
      ...(typeof params.patternKey === 'string' ? { patternKey: params.patternKey } : {}),
    },
    createdAt: row.createdAt,
    title: null,
  };
  if (row.status !== 'ready' || !row.content) return view;

  const c = row.content as Raw;
  const sources = (c.sources ?? {}) as Sources;
  view.title = typeof c.title === 'string' ? c.title : null;
  if (row.type === 'practice_test') {
    view.questions = asArray(c.questions).map((q) => questionView(q, sources));
  } else if (row.type === 'mock_exam') {
    if (typeof c.durationMinutes === 'number') view.durationMinutes = c.durationMinutes;
    view.sections = asArray(c.sections).map((s) => ({
      key: s.key,
      title: s.title,
      questions: asArray(s.questions).map((q) => questionView(q, sources)),
    }));
  } else {
    view.notes = asArray(c.sections).map((s) => ({
      heading: s.heading,
      bodyMarkdown: s.bodyMarkdown,
      chapterId: s.chapterId,
      citations: citationsOf(s.chunkIds, sources),
    }));
  }
  return view;
}

export type AttemptSummary = {
  id: string;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  maxScore: number | null;
};
export type ArtifactDetail = ArtifactView & { attempts: AttemptSummary[] };

export async function getArtifact(actor: Actor, id: string): Promise<ArtifactDetail> {
  const scope = await studentScope(actor);
  if (!UUID_RE.test(id)) throw new DomainError('NOT_FOUND');
  const { row, mine } = await withTenant(scope.schoolId, async (tx) => {
    await reapStaleGenerating(tx, actor.userId);
    const [r] = await tx.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.studentId, actor.userId)));
    if (!r) return { row: null, mine: [] };
    const list = await tx
      .select({
        id: attempts.id, status: attempts.status, startedAt: attempts.startedAt, submittedAt: attempts.submittedAt,
        score: attempts.score, maxScore: attempts.maxScore,
      })
      .from(attempts)
      .where(and(eq(attempts.artifactId, id), eq(attempts.studentId, actor.userId)))
      .orderBy(desc(attempts.startedAt), desc(attempts.id));
    return { row: r, mine: list };
  });
  if (!row) throw new DomainError('NOT_FOUND');
  const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
  return { ...toArtifactView(row), attempts: mine.map((a) => ({ ...a, score: num(a.score), maxScore: num(a.maxScore) })) };
}

export async function listArtifacts(actor: Actor, filter: { type?: ArtifactType } = {}): Promise<ArtifactSummary[]> {
  const scope = await studentScope(actor);
  return withTenant(scope.schoolId, async (tx) => {
    await reapStaleGenerating(tx, actor.userId);
    const rows = await tx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.studentId, actor.userId), filter.type ? eq(artifacts.type, filter.type) : undefined))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id));
    const stats = await tx
      .select({
        artifactId: attempts.artifactId,
        n: sql<number>`count(*)::int`,
        best: sql<string | null>`max(case when ${attempts.status} = 'graded' and ${attempts.maxScore} > 0 then ${attempts.score} / ${attempts.maxScore} end)`,
      })
      .from(attempts)
      .where(eq(attempts.studentId, actor.userId))
      .groupBy(attempts.artifactId);
    const byArtifact = new Map(stats.map((s) => [s.artifactId, s]));
    return rows.map((r) => {
      const s = byArtifact.get(r.id);
      return {
        id: r.id,
        type: r.type as ArtifactType,
        status: r.status,
        subjectId: r.subjectId,
        chapterIds: r.chapterIds,
        title: r.status === 'ready' && typeof (r.content as Raw | null)?.title === 'string' ? (r.content as Raw).title : null,
        createdAt: r.createdAt,
        attemptCount: s?.n ?? 0,
        bestScorePct: s?.best == null ? null : Math.round(Number(s.best) * 1000) / 10,
      };
    });
  });
}
