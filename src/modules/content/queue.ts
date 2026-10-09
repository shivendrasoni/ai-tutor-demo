import { PgBoss } from 'pg-boss';
import { getDeps } from './deps';
import { runIngest, type IngestDeps, type IngestJob } from './ingest';

export const INGEST_QUEUE = 'ingest';
export const INGEST_QUEUE_OPTIONS = { retryLimit: 3, retryBackoff: true } as const;

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
  await boss.createQueue(INGEST_QUEUE, { ...INGEST_QUEUE_OPTIONS });
  return boss;
}

export class PgBossQueue implements IngestQueue {
  private boss: Promise<PgBoss> | null = null;

  async enqueue(job: IngestJob): Promise<void> {
    this.boss ??= startBoss();
    const boss = await this.boss;
    await boss.send(INGEST_QUEUE, job, { singletonKey: job.contentItemId });
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = await this.boss;
    this.boss = null;
    await boss.stop();
  }
}

export async function startWorker(deps?: IngestDeps): Promise<{ stop(): Promise<void> }> {
  const d = deps ?? getDeps();
  const boss = await startBoss();
  // Installed pg-boss 12 names: `includeMetadata` work option; `retryCount` / `retryLimit` on the job.
  await boss.work<IngestJob, void, { includeMetadata: true }>(
    INGEST_QUEUE,
    { includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        await runIngest(job.data, d, { finalAttempt: job.retryCount >= job.retryLimit });
      }
    },
  );
  return { stop: () => boss.stop() };
}
