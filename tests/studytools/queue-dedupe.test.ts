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

describe('a null send (stately dedupe) is only "already queued" when a pending job exists', () => {
  const fake = (rows: { n: number }[], sent: unknown) =>
    ({ send: async () => sent, getDb: () => ({ executeSql: async () => ({ rows }) }) }) as never;

  it('ingest: null send with no pending job throws; with one it resolves', async () => {
    const job = { contentItemId: randomUUID(), schoolId: randomUUID() };
    await expect(new IngestPgBossQueue(async () => fake([{ n: 0 }], null)).enqueue(job)).rejects.toThrow(/not queued/i);
    await expect(new IngestPgBossQueue(async () => fake([{ n: 1 }], null)).enqueue(job)).resolves.toBeUndefined();
    await expect(new IngestPgBossQueue(async () => fake([{ n: 0 }], 'job-id')).enqueue(job)).resolves.toBeUndefined();
  });

  it('generate: null send with no pending job throws; with one it resolves', async () => {
    const d = { artifactId: randomUUID(), schoolId: randomUUID() };
    await expect(new PgBossQueue(async () => fake([{ n: 0 }], null)).enqueueGenerate(d)).rejects.toThrow(/not queued/i);
    await expect(new PgBossQueue(async () => fake([{ n: 1 }], null)).enqueueGenerate(d)).resolves.toBeUndefined();
  });
});
