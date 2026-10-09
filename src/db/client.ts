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

const appPool = new Pool({ connectionString: requireEnv('DATABASE_URL_APP') });
const adminPool = new Pool({ connectionString: requireEnv('DATABASE_URL_ADMIN') });

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
  await Promise.all([appPool.end(), adminPool.end()]);
}
