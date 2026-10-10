import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { redactError } from '@/lib/redact';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function makePool(name: string, envVar: string): Pool {
  const pool = new Pool({
    connectionString: requireEnv(envVar),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. the server restarts) would otherwise crash the process as an unhandled 'error' event.
  pool.on('error', (err) => console.error(`[db] ${name} pool error:`, redactError(err)));
  return pool;
}

// Cached on globalThis so Next dev HMR re-evaluating this module doesn't leak pools. Built when this module is evaluated, so DATABASE_URL_* must already be set.
const g = globalThis as unknown as { __dbPools?: { appPool: Pool; adminPool: Pool } };
const pools = (g.__dbPools ??= {
  appPool: makePool('app', 'DATABASE_URL_APP'),
  adminPool: makePool('admin', 'DATABASE_URL_ADMIN'),
});
const { appPool, adminPool } = pools;

/** Runs as `app_user` (no BYPASSRLS): every query is subject to row-level security. */
export const appDb: Db = drizzle(appPool, { schema });
/** Runs as `app_admin` (BYPASSRLS): platform and system work only. */
export const adminDb: Db = drizzle(adminPool, { schema });

/** Runs `fn` in a transaction with `app.school_id` set (transaction-local, so it never leaks across pooled connections). */
export async function withTenant<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}

/** Runs `fn` in a transaction as `app_admin`, bypassing RLS. */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return adminDb.transaction((tx) => fn(tx));
}

let closing: Promise<unknown> | undefined;
/** Ends both pools. Safe to call more than once. */
export async function closeDb(): Promise<void> {
  delete g.__dbPools;
  closing ??= Promise.all([appPool.end(), adminPool.end()]);
  await closing;
}
