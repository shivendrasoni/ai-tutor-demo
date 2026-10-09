import { beforeAll, describe, expect, it } from 'vitest';
import { FakeEmbedder } from '@/modules/content/embedder';
import { FakeOcrExtractor } from '@/modules/content/ocr';
import { INGEST_QUEUE_OPTIONS, InMemoryQueue, isFinalAttempt, PgBossQueue, startWorker } from '@/modules/content/queue';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { getItem, queueItemFor, testBlobs } from '../helpers/content';
import { textBook30 } from '../helpers/pdfs';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});

async function waitFor(cond: () => Promise<boolean>, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('waitFor timed out');
}

describe('ingest queue', () => {
  it('queue options are retryLimit 3 with backoff', () =>
    expect(INGEST_QUEUE_OPTIONS).toEqual({ retryLimit: 3, retryBackoff: true }));

  it('isFinalAttempt is true only once retryCount reaches retryLimit', () => {
    expect(isFinalAttempt({ retryCount: 2, retryLimit: 3 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 3, retryLimit: 3 })).toBe(true);
  });

  it('InMemoryQueue records jobs', async () => {
    const q = new InMemoryQueue();
    await q.enqueue({ contentItemId: 'i', schoolId: 's' });
    expect(q.jobs).toEqual([{ contentItemId: 'i', schoolId: 's' }]);
  });

  it('worker picks up an enqueued job and the item becomes ready (real pg-boss on the test DB, fakes for AI)', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    const w = await startWorker({ blobs: testBlobs(), embedder: new FakeEmbedder(), ocr: new FakeOcrExtractor() });
    const q = new PgBossQueue();
    try {
      await q.enqueue(job);
      await waitFor(async () => (await getItem(job)).ingestStatus === 'ready', 15_000);
    } finally {
      await q.stop();
      await w.stop();
    }
  }, 30_000);
});
