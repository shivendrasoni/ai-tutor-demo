import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Pools are built when this module is evaluated, so DATABASE_URL_* must already be set.
const appPool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN });

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
  closing ??= Promise.all([appPool.end(), adminPool.end()]);
  await closing;
}
