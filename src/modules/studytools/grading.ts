import { and, eq, sql } from 'drizzle-orm';
import { withPlatform, withTenant } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import { loadActor } from '@/modules/tenancy';
import { redactError } from '@/lib/redact';
import { now } from './clock';
import { failPendingQuestions, finalizeAttempt, NEEDS_REVIEW_FEEDBACK } from './finalize';
import { callGrader } from './llm';
import { buildGraderPrompt } from './prompts';
import { getStudyQueue, type GradeJob, type JobMeta } from './queue';
import { flattenQuestions, type QuestionResult, type Results } from './scoring';

/**
 * Stores one question's result and finalizes if it was the last. The attempt row is locked only for this short
 * transaction (never during the LLM call). A question that already has a result is left alone, so a late grade can
 * not overwrite a needs-review zero and a redelivery is a no-op.
 */
async function storeResult(job: GradeJob, result: QuestionResult): Promise<void> {
  await withTenant(job.schoolId, async (tx) => {
    const [a] = await tx.select({ status: attempts.status, results: attempts.results }).from(attempts).where(eq(attempts.id, job.attemptId)).for('update');
    if (!a || a.status !== 'grading' || (a.results as Results | null)?.[job.questionId]) return;
    await tx
      .update(attempts)
      .set({ results: sql`coalesce(${attempts.results}, '{}'::jsonb) || ${JSON.stringify({ [job.questionId]: result })}::jsonb` })
      .where(eq(attempts.id, job.attemptId));
    await finalizeAttempt(tx, job.attemptId);
  });
}

/** Grades one subjective question. Safe to redeliver; on the final failed retry the question is scored 0 for review. */
export async function handleGradeJob(job: { data: GradeJob } & Partial<JobMeta>): Promise<void> {
  const { attemptId, schoolId, questionId } = job.data;
  const loaded = await withTenant(schoolId, async (tx) => {
    const [a] = await tx.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.schoolId, schoolId)));
    if (!a || a.status !== 'grading' || (a.results as Results | null)?.[questionId]) return null;
    const [art] = await tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, a.artifactId));
    const q = flattenQuestions(art?.content).find((x) => x.id === questionId);
    return q ? { attempt: a, q } : null;
  });
  if (!loaded) return;
  const { attempt, q } = loaded;

  const answer = (attempt.answers as Record<string, unknown> | null)?.[questionId];
  if (q.type === 'mcq' || typeof answer !== 'string' || answer.trim() === '') {
    return storeResult(job.data, { score: 0, maxScore: q.marks });
  }

  const isFinalAttempt = (job.retryCount ?? 0) >= (job.retryLimit ?? 0);
  let graded: { score: number; feedback: string };
  try {
    const actor = await withPlatform((tx) => loadActor(tx, attempt.studentId));
    if (!actor) throw new Error('student not found');
    graded = await callGrader(
      actor,
      buildGraderPrompt(
        { prompt: q.prompt, type: q.type, marks: q.marks, modelAnswer: String(q.modelAnswer ?? ''), rubric: (q.rubric ?? []).map(String) },
        answer,
      ),
      q.marks,
    );
  } catch (e) {
    if (!isFinalAttempt) throw e;
    return storeResult(job.data, { score: 0, maxScore: q.marks, feedback: NEEDS_REVIEW_FEEDBACK, needsReview: true });
  }
  await storeResult(job.data, { score: graded.score, maxScore: q.marks, feedback: graded.feedback });
}

export const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Recovery for an attempt left `grading` (lost jobs, a worker that died on its last attempt, an outage during submit).
 * Past STUCK_AFTER_MS it re-enqueues a grade job for every subjective question without a result at most once per STUCK_AFTER_MS (`recovered_at`; the grade queue also dedupes by singletonKey); if that enqueue fails it zeroes them for review. Best effort: never throws.
 */
export async function recoverStuckAttempt(schoolId: string, attemptId: string): Promise<void> {
  try {
    const pending = await withTenant(schoolId, async (tx) => {
      const [a] = await tx.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.schoolId, schoolId))).for('update');
      if (!a || a.status !== 'grading' || !a.submittedAt || now().getTime() - a.submittedAt.getTime() < STUCK_AFTER_MS) return [];
      // At most one recovery per STUCK_AFTER_MS per attempt, so polling cannot re-enqueue (and re-bill) on every call.
      if (a.recoveredAt && now().getTime() - a.recoveredAt.getTime() < STUCK_AFTER_MS) return [];
      const [art] = await tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, a.artifactId));
      const results = (a.results ?? {}) as Results;
      const ids = flattenQuestions(art?.content).filter((q) => q.type !== 'mcq' && !results[q.id]).map((q) => q.id);
      if (ids.length > 0) await tx.update(attempts).set({ recoveredAt: now() }).where(eq(attempts.id, attemptId));
      return ids;
    });
    if (pending.length === 0) return;
    try {
      await getStudyQueue().enqueueGrade(pending.map((questionId) => ({ attemptId, schoolId, questionId })));
    } catch (e) {
      console.error('[studytools] recovery enqueue failed', redactError(e));
      await failPendingQuestions(schoolId, attemptId);
    }
  } catch (e) {
    console.error('[studytools] recoverStuckAttempt failed', redactError(e));
  }
}
