import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgBoss } from 'pg-boss';
import { ensureQueue, hasPendingJob, migrateQueuePolicies } from '@/lib/boss';

// Real pg-boss on the test DB.
let boss: PgBoss;
const names: string[] = [];
const qname = () => {
  const n = `qm.${randomUUID()}`;
  names.push(n);
  return n;
};
const STATELY = { policy: 'stately' } as const;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL_OWNER, supervise: false, schedule: false, max: 4 });
  boss.on('error', () => {});
  await boss.start();
});
afterAll(async () => {
  for (const n of names) await boss.deleteQueue(n);
  await boss.stop();
});

const policyOf = async (n: string) => (await boss.getQueue(n))?.policy;
const jobCount = async (n: string) => {
  const { rows } = await boss.getDb().executeSql(`select count(*)::int as n from pgboss.job where name = $1`, [n]);
  return rows[0].n as number;
};

describe('queue policy migration', () => {
  it('the send-only path never drops a mismatched queue or its jobs (warns instead)', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    await boss.send(n, { a: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ensureQueue(boss, n, STATELY);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await policyOf(n)).toBe('standard');
    expect(await jobCount(n)).toBe(1);
  });

  it('the worker migrates an empty mismatched queue', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    await migrateQueuePolicies(boss, [{ name: n, options: STATELY }]);
    expect(await policyOf(n)).toBe('stately');
  });

  it('the worker also creates a missing queue', async () => {
    const n = qname();
    await migrateQueuePolicies(boss, [{ name: n, options: STATELY }]);
    expect(await policyOf(n)).toBe('stately');
  });

  it('the worker refuses to drop a queue with live jobs: logs an error and keeps queue and jobs', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    await boss.send(n, { a: 1 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await migrateQueuePolicies(boss, [{ name: n, options: STATELY }]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining(n));
    err.mockRestore();
    expect(await policyOf(n)).toBe('standard');
    expect(await jobCount(n)).toBe(1);
  });

  it('a queue holding only finished jobs counts as empty and is migrated', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    const id = await boss.send(n, { a: 1 });
    const [job] = await boss.fetch(n);
    expect(job.id).toBe(id);
    await boss.complete(n, job.id);
    await migrateQueuePolicies(boss, [{ name: n, options: STATELY }]);
    expect(await policyOf(n)).toBe('stately');
  });

  it('concurrent migrations are serialized: only one drops, the other sees the new policy', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    let deletes = 0;
    const slow = new Proxy(boss, {
      get(t, k) {
        if (k === 'deleteQueue') {
          return async (name: string) => {
            deletes++;
            await new Promise((r) => setTimeout(r, 300));
            return t.deleteQueue(name);
          };
        }
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    await Promise.all([
      migrateQueuePolicies(slow, [{ name: n, options: STATELY }]),
      migrateQueuePolicies(slow, [{ name: n, options: STATELY }]),
    ]);
    expect(deletes).toBe(1);
    expect(await policyOf(n)).toBe('stately');
  });
});

describe('re-check before the drop', () => {
  it('skips the drop when a job lands between the first count and deleteQueue', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    let counts = 0;
    const racing = new Proxy(boss, {
      get(t, k) {
        if (k === 'getDb') {
          return () => ({
            executeSql: async (sql: string, params?: unknown[]) => {
              // A web send arrives right after the first (empty) count.
              if (sql.includes('count(*)') && ++counts === 2) await t.send(n, { late: 1 });
              return t.getDb().executeSql(sql, params);
            },
          });
        }
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await migrateQueuePolicies(racing, [{ name: n, options: STATELY }]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining(n));
    err.mockRestore();
    expect(counts).toBe(2);
    expect(await policyOf(n)).toBe('standard');
    expect(await jobCount(n)).toBe(1);
  });
});

describe('lock connection failure', () => {
  it('aborts the migration cleanly (rejects, no drop) instead of crashing on an unhandled client error', async () => {
    const n = qname();
    await boss.createQueue(n, { policy: 'standard' });
    const fake = Object.assign(new EventEmitter(), {
      connect: async () => {},
      end: async () => {},
      // The connection dies right after the lock is taken.
      query: async () => void queueMicrotask(() => fake.emit('error', new Error('connection terminated'))),
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(migrateQueuePolicies(boss, [{ name: n, options: STATELY }], () => fake as never)).rejects.toThrow(/connection terminated/);
    err.mockRestore();
    expect(await policyOf(n)).toBe('standard');
  });
});

describe('hasPendingJob', () => {
  it('is true only for a created/retry/active job with that singletonKey', async () => {
    const n = qname();
    await boss.createQueue(n, STATELY);
    expect(await hasPendingJob(boss, n, 'k')).toBe(false);
    await boss.send(n, {}, { singletonKey: 'k' });
    expect(await hasPendingJob(boss, n, 'k')).toBe(true);
    expect(await hasPendingJob(boss, n, 'other')).toBe(false);
    const [job] = await boss.fetch(n);
    await boss.complete(n, job.id);
    expect(await hasPendingJob(boss, n, 'k')).toBe(false);
  });
});
