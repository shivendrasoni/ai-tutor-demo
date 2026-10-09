import { getTableName, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { tenantTables } from '@/db/schema';

// Catalog gate (spec §8): any table with a school_id column that lacks forced RLS + a policy, or is
// missing from tenantTables (and so from the isolation suite), fails CI.
const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
const db = drizzle(pool);
afterAll(() => pool.end());

async function schoolIdTables(): Promise<string[]> {
  const res = await db.execute(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'school_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`);
  return res.rows.map((r) => String(r.table_name));
}

describe('RLS catalog', () => {
  it('tenantTables is exactly the set of public tables with a school_id column', async () => {
    const found = await schoolIdTables();
    expect(found.length).toBeGreaterThan(0);
    expect([...tenantTables.map((t) => getTableName(t))].sort()).toEqual([...found].sort());
  });

  it('every school_id table (plus schools) has RLS enabled and forced, with at least one policy', async () => {
    const names = [...(await schoolIdTables()), 'schools'];
    const res = await db.execute(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    const byName = new Map(res.rows.map((r) => [String(r.relname), r]));
    for (const name of names) {
      const row = byName.get(name);
      expect(row, `${name} exists`).toBeTruthy();
      expect(row!.relrowsecurity, `${name} relrowsecurity`).toBe(true);
      expect(row!.relforcerowsecurity, `${name} relforcerowsecurity`).toBe(true);
      expect(Number(row!.policies), `${name} policies`).toBeGreaterThanOrEqual(1);
    }
  });
});
