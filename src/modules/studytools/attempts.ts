import { and, desc, eq } from 'drizzle-orm';
import { withTenant, type Tx } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { studentScope } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { toArtifactView, questionView, type ArtifactView, type ViewQuestion } from './artifacts';
import { now } from './clock';
import { failPendingQuestions, finalizeAttempt } from './finalize';
import { redactError } from '@/lib/redact';
import { recoverStuckAttempt } from './grading';
import { getStudyQueue } from './queue';
import { buildByChapter, flattenQuestions, scoreMcq, type ByChapter, type Results } from './scoring';
import type { Sources, StoredQuestion } from './schemas';

const GRACE_MS = 2 * 60_000;
const MAX_ANSWER_CHARS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ArtifactRow = typeof artifacts.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type Answers = Record<string, number | string>;

export type ReviewQuestion = ViewQuestion & { correctIndex?: number; modelAnswer?: string; rubric?: string[] };
export type AttemptView = {
  id: string;
  artifactId: string;
  status: string;
  startedAt: Date;
  deadline: Date | null;
  submittedAt: Date | null;
  answers: Answers;
  artifact: ArtifactView;
  results?: Results;
  score?: number;
  maxScore?: number;
  byChapter?: ByChapter;
  questions?: ReviewQuestion[];
};

const validation = (m: string) => new DomainError('VALIDATION', m);
const notFound = () => new DomainError('NOT_FOUND');

function deadlineOf(art: ArtifactRow, startedAt: Date): Date | null {
  if (art.type !== 'mock_exam') return null;
  const minutes = (art.content as { durationMinutes?: unknown } | null)?.durationMinutes;
  return typeof minutes === 'number' ? new Date(startedAt.getTime() + minutes * 60_000) : null;
}

const assertNotExpired = (art: ArtifactRow, a: AttemptRow): void => {
  const d = deadlineOf(art, a.startedAt);
  if (d && now().getTime() > d.getTime() + GRACE_MS) throw new DomainError('ATTEMPT_EXPIRED', 'The time for this attempt is over');
};

/** Loads the student's own attempt (locked for update when asked) plus its artifact. */
async function loadOwn(tx: Tx, actor: Actor, attemptId: string, lock: boolean): Promise<{ attempt: AttemptRow; artifact: ArtifactRow }> {
  if (!UUID_RE.test(attemptId)) throw notFound();
  const q = tx.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.studentId, actor.userId)));
  const [attempt] = await (lock ? q.for('update') : q);
  if (!attempt) throw notFound();
  const [artifact] = await tx.select().from(artifacts).where(eq(artifacts.id, attempt.artifactId));
  if (!artifact) throw notFound();
  return { attempt, artifact };
}

export async function startAttempt(actor: Actor, artifactId: string): Promise<{ attemptId: string; startedAt: Date; deadline: Date | null }> {
  const scope = await studentScope(actor);
  if (!UUID_RE.test(artifactId)) throw notFound();
  return withTenant(scope.schoolId, async (tx) => {
    // Lock the artifact row so concurrent starts resume the same attempt instead of creating two.
    const [art] = await tx.select().from(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.studentId, actor.userId))).for('update');
    if (!art) throw notFound();
    if (art.type !== 'practice_test' && art.type !== 'mock_exam') throw validation('Only tests can be attempted');
    if (art.status !== 'ready') throw validation('This test is not ready yet');
    const open = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.artifactId, artifactId), eq(attempts.studentId, actor.userId), eq(attempts.status, 'in_progress')))
      .orderBy(desc(attempts.startedAt));
    for (const o of open) {
      const d = deadlineOf(art, o.startedAt);
      if (!d || now().getTime() <= d.getTime() + GRACE_MS) return { attemptId: o.id, startedAt: o.startedAt, deadline: d };
    }
    const startedAt = now();
    const [row] = await tx
      .insert(attempts)
      .values({ schoolId: scope.schoolId, artifactId, studentId: actor.userId, status: 'in_progress', startedAt, answers: {} })
      .returning({ id: attempts.id });
    return { attemptId: row!.id, startedAt, deadline: deadlineOf(art, startedAt) };
  });
}

function validateAnswers(questions: StoredQuestion[], answers: unknown): Answers {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw validation('answers must be an object');
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Answers = {};
  for (const [id, value] of Object.entries(answers)) {
    const q = byId.get(id);
    if (!q) throw validation('Unknown question');
    if (q.type === 'mcq') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3) throw validation('Invalid answer');
    } else if (typeof value !== 'string' || value.length > MAX_ANSWER_CHARS) {
      throw validation('Invalid answer');
    }
    out[id] = value as number | string;
  }
  return out;
}

export async function saveAnswers(actor: Actor, attemptId: string, answers: Answers): Promise<void> {
  const scope = await studentScope(actor);
  await withTenant(scope.schoolId, async (tx) => {
    const { attempt, artifact } = await loadOwn(tx, actor, attemptId, true);
    if (attempt.status !== 'in_progress') throw validation('This attempt is already submitted');
    assertNotExpired(artifact, attempt);
    const clean = validateAnswers(flattenQuestions(artifact.content), answers);
    await tx.update(attempts).set({ answers: clean }).where(eq(attempts.id, attemptId));
  });
}

export async function submitAttempt(actor: Actor, attemptId: string): Promise<{ status: 'grading' | 'graded' }> {
  const scope = await studentScope(actor);
  const outcome = await withTenant(scope.schoolId, async (tx) => {
    // The row lock makes a concurrent second submit wait, then see a non-in_progress status.
    const { attempt, artifact } = await loadOwn(tx, actor, attemptId, true);
    if (attempt.status !== 'in_progress') return { status: attempt.status as 'grading' | 'graded', jobs: [] as string[], already: true };
    assertNotExpired(artifact, attempt);

    const answers = (attempt.answers ?? {}) as Answers;
    const results: Results = {};
    const jobs: string[] = [];
    for (const q of flattenQuestions(artifact.content)) {
      const answer = answers[q.id];
      if (q.type === 'mcq') {
        results[q.id] = scoreMcq(q, answer);
      } else if (typeof answer === 'string' && answer.trim() !== '') {
        jobs.push(q.id);
      } else {
        results[q.id] = { score: 0, maxScore: q.marks };
      }
    }
    await tx.update(attempts).set({ status: 'grading', submittedAt: now(), results }).where(eq(attempts.id, attemptId));
    const finalized = await finalizeAttempt(tx, attemptId);
    return { status: finalized ? ('graded' as const) : ('grading' as const), jobs, already: false };
  });

  if (outcome.already && outcome.status === 'grading') await recoverStuckAttempt(scope.schoolId, attemptId);
  if (outcome.jobs.length > 0) {
    try {
      await getStudyQueue().enqueueGrade(outcome.jobs.map((questionId) => ({ attemptId, schoolId: scope.schoolId, questionId })));
    } catch (e) {
      console.error('[studytools] grade enqueue failed', redactError(e));
      // Nothing will grade these questions: score them 0 for review so the attempt still finalizes.
      await failPendingQuestions(scope.schoolId, attemptId);
      return { status: 'graded' };
    }
  }
  return { status: outcome.status };
}

const num = (v: string | null): number | undefined => (v == null ? undefined : Number(v));

function reviewQuestion(q: StoredQuestion, sources: Sources): ReviewQuestion {
  return {
    ...questionView(q, sources),
    ...(typeof q.correctIndex === 'number' ? { correctIndex: q.correctIndex } : {}),
    ...(typeof q.modelAnswer === 'string' ? { modelAnswer: q.modelAnswer } : {}),
    ...(Array.isArray(q.rubric) ? { rubric: q.rubric.map(String) } : {}),
  };
}

function resultsView(r: unknown): Results {
  const out: Results = {};
  for (const [id, v] of Object.entries((r ?? {}) as Record<string, Results[string]>)) {
    out[id] = {
      score: v.score,
      maxScore: v.maxScore,
      ...(v.feedback !== undefined ? { feedback: v.feedback } : {}),
      ...(v.correct !== undefined ? { correct: v.correct } : {}),
      ...(v.needsReview ? { needsReview: true as const } : {}),
    };
  }
  return out;
}

export async function getAttempt(actor: Actor, attemptId: string): Promise<AttemptView> {
  const scope = await studentScope(actor);
  const load = () => withTenant(scope.schoolId, (tx) => loadOwn(tx, actor, attemptId, false));
  let loaded = await load();
  if (loaded.attempt.status === 'grading') {
    await recoverStuckAttempt(scope.schoolId, attemptId); // best effort; no-op until the attempt looks stuck
    loaded = await load();
  }
  const { attempt, artifact } = loaded;
  const view: AttemptView = {
    id: attempt.id,
    artifactId: attempt.artifactId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadline: deadlineOf(artifact, attempt.startedAt),
    submittedAt: attempt.submittedAt,
    answers: { ...((attempt.answers ?? {}) as Answers) },
    artifact: toArtifactView(artifact),
  };
  if (!attempt.submittedAt) return view;

  const sources = ((artifact.content as { sources?: Sources } | null)?.sources ?? {}) as Sources;
  view.results = resultsView(attempt.results);
  view.questions = flattenQuestions(artifact.content).map((q) => reviewQuestion(q, sources));
  if (attempt.status === 'graded') {
    view.score = num(attempt.score);
    view.maxScore = num(attempt.maxScore);
    view.byChapter = (attempt.byChapter ?? {}) as ByChapter;
  }
  return view;
}
