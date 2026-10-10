import { Client } from 'pg';
import { PgBoss, type ConstructorOptions } from 'pg-boss';

/** The web process only sends jobs: no maintenance/cron timers and a small pool. The worker keeps a full boss. */
export const SEND_BOSS_OPTIONS = { supervise: false, schedule: false, max: 2 } as const;

type BossFactory = (options: ConstructorOptions) => PgBoss;

/** pg-boss needs DDL rights (it creates the `pgboss` schema), so it connects as the owner. */
const defaultFactory: BossFactory = (options) => new PgBoss({ connectionString: process.env.DATABASE_URL_OWNER, ...options });

// Cached on globalThis (like `__dbPools` in src/db/client.ts) so Next dev HMR re-evaluating modules does not leak bosses.
const g = globalThis as unknown as { __sendBoss?: Promise<PgBoss> };

/**
 * The one send-only boss of this process, started on first use. A failed start is not cached: the next call retries.
 * `factory` is a test seam.
 */
export async function getSendBoss(factory: BossFactory = defaultFactory): Promise<PgBoss> {
  const starting =
    (g.__sendBoss ??= (async () => {
      const boss = factory({ ...SEND_BOSS_OPTIONS });
      boss.on('error', (err) => console.error('[pg-boss]', err));
      await boss.start();
      boss.once('stopped', () => {
        if (g.__sendBoss === starting) g.__sendBoss = undefined;
      });
      return boss;
    })());
  try {
    return await starting;
  } catch (err) {
    if (g.__sendBoss === starting) g.__sendBoss = undefined;
    throw err;
  }
}

/** Stops and forgets the shared send boss (shutdown and tests). */
export async function stopSendBoss(): Promise<void> {
  const starting = g.__sendBoss;
  g.__sendBoss = undefined;
  if (!starting) return;
  const boss = await starting.catch(() => null);
  await boss?.stop();
}

type QueueOptions = NonNullable<Parameters<PgBoss['createQueue']>[1]>;
export type QueueSpec = { name: string; options: QueueOptions };

/**
 * Send-only queue setup (web process, and the worker after migration): an idempotent `createQueue`, never a drop.
 * pg-boss cannot change a queue's policy after creation and `deleteQueue` deletes all its jobs, so a policy
 * mismatch is only warned about here; `migrateQueuePolicies` (worker startup) is the one place that may fix it.
 */
export async function ensureQueue(
  boss: Pick<PgBoss, 'createQueue' | 'getQueue'>,
  name: string,
  options: QueueOptions,
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (existing) {
    const wanted = options.policy ?? 'standard';
    if (existing.policy !== wanted) {
      console.warn(`[pg-boss] queue ${name} has policy ${existing.policy}, expected ${wanted}; the worker migrates it at startup`);
    }
    return;
  }
  await boss.createQueue(name, options);
}

const MIGRATION_LOCK_KEY = 'tutor:pgboss-queue-policy-migration';
const LIVE_STATES = `('created','retry','active')`;

/**
 * Worker startup only. Under a Postgres advisory lock (so concurrent workers serialize), creates missing queues and
 * drops and recreates a queue whose policy differs, but only when it has no job in created/retry/active. Otherwise it
 * logs an error and keeps the old queue (and its jobs); the next worker start retries once the queue has drained.
 * Jobs in finished states (completed/cancelled/failed) are history and are lost with the drop.
 */
export async function migrateQueuePolicies(
  boss: Pick<PgBoss, 'createQueue' | 'getQueue' | 'deleteQueue' | 'getDb'>,
  specs: QueueSpec[],
): Promise<void> {
  // A session-level lock needs one dedicated connection held for the whole migration, so it is not taken through boss's pool.
  const lock = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    for (const { name, options } of specs) {
      const existing = await boss.getQueue(name);
      const wanted = options.policy ?? 'standard';
      if (!existing) {
        await boss.createQueue(name, options);
        continue;
      }
      if (existing.policy === wanted) continue;
      const { rows } = await boss
        .getDb()
        .executeSql(`select count(*)::int as n from pgboss.job where name = $1 and state in ${LIVE_STATES}`, [name]);
      if (rows[0].n > 0) {
        console.error(
          `[pg-boss] NOT migrating queue ${name} (policy ${existing.policy} -> ${wanted}): ${rows[0].n} live job(s). Keeping the old queue; drain it and restart the worker.`,
        );
        continue;
      }
      console.warn(`[pg-boss] recreating empty queue ${name}: policy ${existing.policy} -> ${wanted}`);
      await boss.deleteQueue(name);
      await boss.createQueue(name, options);
    }
  } finally {
    // Closing the session releases the advisory lock even if the unlock query would fail.
    await lock.end().catch(() => undefined);
  }
}

/** True when a job with this singletonKey is waiting or running (created/retry/active) on the queue. */
export async function hasPendingJob(boss: Pick<PgBoss, 'getDb'>, queue: string, key: string): Promise<boolean> {
  const { rows } = await boss
    .getDb()
    .executeSql(`select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2 and state in ${LIVE_STATES}`, [queue, key]);
  return rows[0].n > 0;
}

/**
 * `boss.send` on a stately queue returns null when it dedupes against a pending job. That is "already queued" only
 * if such a job really exists; otherwise the job was lost, so throw and let the caller mark the work failed.
 */
export async function sendDeduped(
  boss: Pick<PgBoss, 'send' | 'getDb'>,
  queue: string,
  data: object,
  options: NonNullable<Parameters<PgBoss['send']>[2]> & { singletonKey: string },
): Promise<void> {
  const id = await boss.send(queue, data, options);
  if (id === null && !(await hasPendingJob(boss, queue, options.singletonKey))) {
    throw new Error(`Job for ${queue}/${options.singletonKey} was not queued (deduped but no pending job exists)`);
  }
}
