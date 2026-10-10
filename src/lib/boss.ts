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

/**
 * Creates a queue. pg-boss cannot change a queue's policy after creation, so a queue left over from an older
 * policy (existing dev DBs) is dropped and recreated; its queued jobs are lost, which the callers' recovery
 * paths (stuck-attempt recovery, the generating reaper, re-upload) already cover.
 */
export async function ensureQueue(
  boss: Pick<PgBoss, 'createQueue' | 'getQueue' | 'deleteQueue'>,
  name: string,
  options: NonNullable<Parameters<PgBoss['createQueue']>[1]>,
): Promise<void> {
  const existing = await boss.getQueue(name);
  const wanted = options.policy ?? 'standard';
  if (existing) {
    if (existing.policy === wanted) return;
    console.warn(`[pg-boss] recreating queue ${name}: policy ${existing.policy} -> ${wanted}`);
    await boss.deleteQueue(name);
  }
  await boss.createQueue(name, options);
}
