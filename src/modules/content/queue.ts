import { PgBoss } from 'pg-boss';
import { ensureQueue, getSendBoss, hasPendingJob, migrateQueuePolicies, sendDeduped, type QueueSpec } from '@/lib/boss';
import { getDeps } from './deps';
import { runIngest, type IngestDeps, type IngestJob } from './ingest';

export const INGEST_QUEUE = 'ingest';
export const INGEST_QUEUE_OPTIONS = { retryLimit: 3, retryBackoff: true, expireInSeconds: 3600 } as const;
// `stately` makes the per-item `singletonKey` real: one queued (created/retry) and one active job per content item.
const INGEST_QUEUE_POLICY = { ...INGEST_QUEUE_OPTIONS, policy: 'stately' } as const;

export interface IngestQueue {
  enqueue(job: IngestJob): Promise<void>;
  /** True while a job for this item is queued/retrying/active (used to tell a stuck item from a running one). */
  hasLiveJob(contentItemId: string): Promise<boolean>;
}

export class InMemoryQueue implements IngestQueue {
  readonly jobs: IngestJob[] = [];
  async enqueue(job: IngestJob): Promise<void> {
    this.jobs.push(job);
  }
  async hasLiveJob(contentItemId: string): Promise<boolean> {
    return this.jobs.some((j) => j.contentItemId === contentItemId);
  }
}

/** pg-boss needs DDL rights (it creates the `pgboss` schema), so it connects as the owner. */
export function createBoss(): PgBoss {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL_OWNER });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  return boss;
}

export const INGEST_QUEUE_SPEC: QueueSpec = { name: INGEST_QUEUE, options: { ...INGEST_QUEUE_POLICY } };

/** Worker boss. The worker is the only process that may migrate a queue's policy (`extraQueues`: other modules' queues). */
export async function startBoss(extraQueues: QueueSpec[] = []): Promise<PgBoss> {
  const boss = createBoss();
  await boss.start();
  await migrateQueuePolicies(boss, [INGEST_QUEUE_SPEC, ...extraQueues]);
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
    await sendDeduped(boss, INGEST_QUEUE, job, { singletonKey: job.contentItemId });
  }

  async hasLiveJob(contentItemId: string): Promise<boolean> {
    return hasPendingJob(await (this.boss ??= this.starter()), INGEST_QUEUE, contentItemId);
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

export async function startWorker(
  deps?: IngestDeps,
  extraQueues: QueueSpec[] = [],
): Promise<{ stop(): Promise<void>; boss: PgBoss }> {
  const d = deps ?? getDeps();
  const boss = await startBoss(extraQueues);
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
