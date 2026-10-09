import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
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
  pool.on('error', (err) => console.error(`[db] ${name} pool error:`, err));
  return pool;
}

// Cached on globalThis so Next dev HMR re-evaluating this module doesn't leak pools.
const g = globalThis as unknown as { __dbPools?: { appPool: Pool; adminPool: Pool } };
const pools = (g.__dbPools ??= {
  appPool: makePool('app', 'DATABASE_URL_APP'),
  adminPool: makePool('admin', 'DATABASE_URL_ADMIN'),
});
const { appPool, adminPool } = pools;

/** Connects as app_user (subject to RLS). */
export const appDb: Db = drizzle(appPool, { schema });
/** Connects as app_admin (BYPASSRLS). Platform-level operations only. */
export const adminDb: Db = drizzle(adminPool, { schema });

export function withTenant<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}

export function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return adminDb.transaction((tx) => fn(tx));
}

export async function closeDb(): Promise<void> {
  delete g.__dbPools;
  await Promise.all([appPool.end(), adminPool.end()]);
}
