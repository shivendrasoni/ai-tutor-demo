import { eq, sql } from 'drizzle-orm';
import { withTenant, type Tx } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import { buildByChapter, flattenQuestions, type Results } from './scoring';

/**
 * Locks the attempt row, and if every question has a result and the attempt is not yet graded, writes the totals
 * and marks it graded. Idempotent: returns false when there is nothing to do.
 */
export async function finalizeAttempt(tx: Tx, attemptId: string): Promise<boolean> {
  const [a] = await tx.select().from(attempts).where(eq(attempts.id, attemptId)).for('update');
  if (!a || a.status === 'graded' || a.status === 'in_progress') return false;
  const [art] = await tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, a.artifactId));
  const questions = flattenQuestions(art?.content);
  const results = (a.results ?? {}) as Results;
  if (!questions.every((q) => results[q.id])) return false;
  const score = questions.reduce((s, q) => s + results[q.id]!.score, 0);
  const maxScore = questions.reduce((s, q) => s + q.marks, 0);
  await tx
    .update(attempts)
    .set({ status: 'graded', score: String(score), maxScore: String(maxScore), byChapter: buildByChapter(questions, results), gradedAt: sql`now()` })
    .where(eq(attempts.id, attemptId));
  return true;
}

/**
 * Fallback for questions that will never be graded (for example a failed enqueue): every question without a result
 * gets score 0 with `needsReview`, then the attempt is finalized. Task 7 reuses this for final-retry grader failures.
 */
export async function failPendingQuestions(schoolId: string, attemptId: string): Promise<void> {
  await withTenant(schoolId, async (tx) => {
    const [a] = await tx.select().from(attempts).where(eq(attempts.id, attemptId)).for('update');
    if (!a || a.status !== 'grading') return;
    const [art] = await tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, a.artifactId));
    const results: Results = { ...((a.results ?? {}) as Results) };
    for (const q of flattenQuestions(art?.content)) {
      if (!results[q.id]) results[q.id] = { score: 0, maxScore: q.marks, needsReview: true };
    }
    await tx.update(attempts).set({ results }).where(eq(attempts.id, attemptId));
    await finalizeAttempt(tx, attemptId);
  });
}
