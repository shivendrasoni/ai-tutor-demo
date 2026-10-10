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

const isExpired = (art: ArtifactRow, a: AttemptRow): boolean => {
  const d = deadlineOf(art, a.startedAt);
  return d !== null && now().getTime() > d.getTime() + GRACE_MS;
};

/**
 * Scores an `in_progress` attempt and moves it to `grading` (or `graded` when nothing needs the grader). The caller holds
 * the attempt row lock. MCQs are scored, blank subjective answers score 0, answered ones are returned as `jobs`.
 */
async function closeAttempt(tx: Tx, attempt: AttemptRow, artifact: ArtifactRow, submittedAt: Date): Promise<{ status: 'grading' | 'graded'; jobs: string[] }> {
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
  await tx.update(attempts).set({ status: 'grading', submittedAt, results }).where(eq(attempts.id, attempt.id));
  const finalized = await finalizeAttempt(tx, attempt.id);
  return { status: finalized ? 'graded' : 'grading', jobs };
}

/** Enqueues grade jobs after the closing transaction committed; a failed enqueue scores the pending questions 0 for review. */
async function dispatchGradeJobs(schoolId: string, attemptId: string, jobs: string[], status: 'grading' | 'graded'): Promise<'grading' | 'graded'> {
  if (jobs.length === 0) return status;
  try {
    await getStudyQueue().enqueueGrade(jobs.map((questionId) => ({ attemptId, schoolId, questionId })));
  } catch (e) {
    console.error('[studytools] grade enqueue failed', redactError(e));
    // Nothing will grade these questions: score them 0 for review so the attempt still finalizes.
    await failPendingQuestions(schoolId, attemptId);
    return 'graded';
  }
  return status;
}

export async function startAttempt(actor: Actor, artifactId: string): Promise<{ attemptId: string; startedAt: Date; deadline: Date | null }> {
  const scope = await studentScope(actor);
  if (!UUID_RE.test(artifactId)) throw notFound();
  const closed: { attemptId: string; jobs: string[]; status: 'grading' | 'graded' }[] = [];
  const started = await withTenant(scope.schoolId, async (tx) => {
    // Lock the artifact row so concurrent starts resume the same attempt instead of creating two.
    const [art] = await tx.select().from(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.studentId, actor.userId))).for('update');
    if (!art) throw notFound();
    if (art.type !== 'practice_test' && art.type !== 'mock_exam') throw validation('Only tests can be attempted');
    if (art.status !== 'ready') throw validation('This test is not ready yet');
    const open = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.artifactId, artifactId), eq(attempts.studentId, actor.userId), eq(attempts.status, 'in_progress')))
      .orderBy(desc(attempts.startedAt))
      .for('update');
    for (const o of open) {
      const d = deadlineOf(art, o.startedAt);
      if (!isExpired(art, o)) return { attemptId: o.id, startedAt: o.startedAt, deadline: d };
      // Expired and never submitted: close it at its deadline so it gets scored instead of lingering.
      const c = await closeAttempt(tx, o, art, d!);
      closed.push({ attemptId: o.id, ...c });
    }
    const startedAt = now();
    const [row] = await tx
      .insert(attempts)
      .values({ schoolId: scope.schoolId, artifactId, studentId: actor.userId, status: 'in_progress', startedAt, answers: {} })
      .returning({ id: attempts.id });
    return { attemptId: row!.id, startedAt, deadline: deadlineOf(art, startedAt) };
  });
  for (const c of closed) await dispatchGradeJobs(scope.schoolId, c.attemptId, c.jobs, c.status);
  return started;
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
    return { ...(await closeAttempt(tx, attempt, artifact, now())), already: false };
  });

  if (outcome.already && outcome.status === 'grading') await recoverStuckAttempt(scope.schoolId, attemptId);
  return { status: await dispatchGradeJobs(scope.schoolId, attemptId, outcome.jobs, outcome.status) };
}

/** Closes the student's own attempt when it is still `in_progress` past its deadline plus grace (submittedAt = deadline). */
async function closeIfExpired(actor: Actor, schoolId: string, attemptId: string): Promise<void> {
  const out = await withTenant(schoolId, async (tx) => {
    const { attempt, artifact } = await loadOwn(tx, actor, attemptId, true);
    if (attempt.status !== 'in_progress' || !isExpired(artifact, attempt)) return null;
    return closeAttempt(tx, attempt, artifact, deadlineOf(artifact, attempt.startedAt)!);
  });
  if (out) await dispatchGradeJobs(schoolId, attemptId, out.jobs, out.status);
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
  if (loaded.attempt.status === 'in_progress' && isExpired(loaded.artifact, loaded.attempt)) {
    await closeIfExpired(actor, scope.schoolId, attemptId);
    loaded = await load();
  }
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
