import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, withPlatform, withTenant } from '../../src/db/client';

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
  });

  it('withPlatform connects as app_admin', async () => {
    const r = await withPlatform((tx) => tx.execute(sql`select current_user as u`));
    expect(r.rows[0].u).toBe('app_admin');
  });
});
