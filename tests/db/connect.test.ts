import { afterAll, describe, expect, it } from 'vitest';
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
});
