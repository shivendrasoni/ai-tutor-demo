import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { appDb, closeDb, withPlatform, withTenant } from '../../src/db/client';

afterAll(async () => {
  await closeDb();
});

describe('db connectivity', () => {
  it('withTenant sets app.school_id transaction-locally', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const inside = await withTenant(id, (tx) =>
      tx.execute(sql`select current_setting('app.school_id', true) as v`),
    );
    expect(inside.rows[0].v).toBe(id);
    await withTenant(id, async () => null);
    const after = await withPlatform((tx) =>
      tx.execute(sql`select current_setting('app.school_id', true) as v`),
    );
    expect([null, '']).toContain(after.rows[0].v);

    // Same app pool: a leaked (non-local) set_config would still be visible here.
    const sameConn = await appDb.execute(sql`select current_setting('app.school_id', true) as v`);
    expect([null, '']).toContain(sameConn.rows[0].v);
    const other = '00000000-0000-0000-0000-000000000002';
    const second = await withTenant(other, (tx) =>
      tx.execute(sql`select current_setting('app.school_id', true) as v`),
    );
    expect(second.rows[0].v).toBe(other);
    const again = await appDb.execute(sql`select current_setting('app.school_id', true) as v`);
    expect([null, '']).toContain(again.rows[0].v);
  });

  it('withPlatform connects as app_admin', async () => {
    const r = await withPlatform((tx) => tx.execute(sql`select current_user as u`));
    expect(r.rows[0].u).toBe('app_admin');
  });

  it('both pools have an error listener and bounded timeouts, cached on globalThis', () => {
    const pools = (globalThis as unknown as { __dbPools?: Record<string, { listenerCount(e: string): number; options: { connectionTimeoutMillis?: number; idleTimeoutMillis?: number } }> }).__dbPools;
    expect(pools).toBeDefined();
    for (const p of [pools!.appPool, pools!.adminPool]) {
      expect(p.listenerCount('error')).toBeGreaterThan(0);
      expect(p.options.connectionTimeoutMillis).toBe(5_000);
      expect(p.options.idleTimeoutMillis).toBe(30_000);
    }
  });

  it('fails fast when a DATABASE_URL_* variable is missing', async () => {
    const g = globalThis as unknown as { __dbPools?: unknown };
    const saved = g.__dbPools;
    const savedUrl = process.env.DATABASE_URL_APP;
    try {
      delete g.__dbPools;
      delete process.env.DATABASE_URL_APP;
      vi.resetModules();
      await expect(import('../../src/db/client')).rejects.toThrow('DATABASE_URL_APP is not set');
    } finally {
      process.env.DATABASE_URL_APP = savedUrl;
      g.__dbPools = saved;
      vi.resetModules();
    }
  });
});
