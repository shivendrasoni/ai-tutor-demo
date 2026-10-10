import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getSendBoss, stopSendBoss } from '@/lib/boss';
import { INGEST_QUEUE } from '@/modules/content/queue';
import { GENERATE_QUEUE, GRADE_QUEUE, PgBossQueue } from '@/modules/studytools/queue';
import { PgBossQueue as IngestPgBossQueue } from '@/modules/content/queue';

// Real pg-boss on the test DB: singletonKey only dedupes on a stately queue.
afterAll(() => stopSendBoss());

async function pending(queue: string, key: string): Promise<number> {
  const boss = await getSendBoss();
  const { rows } = await boss.getDb().executeSql(
    `select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2 and state < 'completed'`,
    [queue, key],
  );
  return rows[0].n;
}

describe('stately queues dedupe by singletonKey', () => {
  it('grade: the same (attempt, question) enqueued twice is one job; a different question is another', async () => {
    const q = new PgBossQueue();
    const attemptId = randomUUID();
    const job = { attemptId, schoolId: randomUUID(), questionId: 'q1' };
    await q.enqueueGrade([job]);
    await q.enqueueGrade([job, { ...job, questionId: 'q2' }]);
    expect(await pending(GRADE_QUEUE, `${attemptId}:q1`)).toBe(1);
    expect(await pending(GRADE_QUEUE, `${attemptId}:q2`)).toBe(1);
  });

  it('generate: the same artifact enqueued twice is one job', async () => {
    const q = new PgBossQueue();
    const artifactId = randomUUID();
    await q.enqueueGenerate({ artifactId, schoolId: randomUUID() });
    await q.enqueueGenerate({ artifactId, schoolId: randomUUID() });
    expect(await pending(GENERATE_QUEUE, artifactId)).toBe(1);
  });

  it('ingest: the same content item enqueued twice is one job', async () => {
    const q = new IngestPgBossQueue();
    const contentItemId = randomUUID();
    await q.enqueue({ contentItemId, schoolId: randomUUID() });
    await q.enqueue({ contentItemId, schoolId: randomUUID() });
    expect(await pending(INGEST_QUEUE, contentItemId)).toBe(1);
  });
});
