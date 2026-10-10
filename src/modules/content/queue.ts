import { PgBoss } from 'pg-boss';
import { ensureQueue, getSendBoss } from '@/lib/boss';
import { getDeps } from './deps';
import { runIngest, type IngestDeps, type IngestJob } from './ingest';

export const INGEST_QUEUE = 'ingest';
export const INGEST_QUEUE_OPTIONS = { retryLimit: 3, retryBackoff: true, expireInSeconds: 3600 } as const;
// `stately` makes the per-item `singletonKey` real: one queued (created/retry) and one active job per content item.
const INGEST_QUEUE_POLICY = { ...INGEST_QUEUE_OPTIONS, policy: 'stately' } as const;

export interface IngestQueue {
  enqueue(job: IngestJob): Promise<void>;
}

export class InMemoryQueue implements IngestQueue {
  readonly jobs: IngestJob[] = [];
  async enqueue(job: IngestJob): Promise<void> {
    this.jobs.push(job);
  }
}

/** pg-boss needs DDL rights (it creates the `pgboss` schema), so it connects as the owner. */
export function createBoss(): PgBoss {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL_OWNER });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  const boss = createBoss();
  await boss.start();
  await ensureQueue(boss, INGEST_QUEUE, { ...INGEST_QUEUE_POLICY });
  return boss;
}

/** Web-process boss: shared, send-only (no supervise/schedule timers), queue ensured on first use. */
async function startSendBoss(): Promise<PgBoss> {
  const boss = await getSendBoss();
  await ensureQueue(boss, INGEST_QUEUE, { ...INGEST_QUEUE_POLICY });
  return boss;
}

export class PgBossQueue implements IngestQueue {
  private boss: Promise<PgBoss> | null = null;

  constructor(private readonly starter: () => Promise<PgBoss> = startSendBoss) {}

  async enqueue(job: IngestJob): Promise<void> {
    const starting = (this.boss ??= this.starter());
    let boss: PgBoss;
    try {
      boss = await starting;
    } catch (err) {
      // Do not cache a failed start: the next enqueue retries instead of failing until restart.
      if (this.boss === starting) this.boss = null;
      throw err;
    }
    await boss.send(INGEST_QUEUE, job, { singletonKey: job.contentItemId });
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = await this.boss;
    this.boss = null;
    await boss.stop();
  }
}

export const isFinalAttempt = (job: { retryCount: number; retryLimit: number }) =>
  job.retryCount >= job.retryLimit;

export async function startWorker(deps?: IngestDeps): Promise<{ stop(): Promise<void>; boss: PgBoss }> {
  const d = deps ?? getDeps();
  const boss = await startBoss();
  // Installed pg-boss 12 names: `includeMetadata` work option; `retryCount` / `retryLimit` on the job.
  await boss.work<IngestJob, void, { includeMetadata: true }>(
    INGEST_QUEUE,
    { includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await runIngest(job.data, d, { finalAttempt: isFinalAttempt(job) });
      }
    },
  );
  return { stop: () => boss.stop(), boss };
}
