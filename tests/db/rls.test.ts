import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { plans, schools, studentProfiles, subjects } from '@/db/schema';
import { appDbRaw, resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(async () => {
  await closeDb();
});

describe('row-level security', () => {
  it('tenant context sees only its own school rows', async () => {
    const rows = await withTenant(seed.a.schoolId, (tx) => tx.select().from(studentProfiles));
    expect(rows.map((r) => r.schoolId)).toEqual([seed.a.schoolId]);
  });
  it('no tenant context fails closed', async () => {
    const r = await appDbRaw(sql`select count(*)::int as n from student_profiles`);
    expect(r.rows[0].n).toBe(0);
  });
  it('cannot insert a row for another school', async () => {
    // Drizzle wraps driver errors; the Postgres message is on `cause`.
    await expect(
      withTenant(seed.a.schoolId, (tx) => tx.insert(subjects).values({ schoolId: seed.b.schoolId, name: 'X' })),
    ).rejects.toMatchObject({ cause: { code: '42501', message: expect.stringMatching(/row-level security/) } });
  });
  it('platform sees all schools', async () => {
    const rows = await withPlatform((tx) => tx.select().from(schools));
    expect(rows).toHaveLength(2);
  });
  it('plans are read-only for app_user (update and delete are permission denied)', async () => {
    const rows = await withTenant(seed.a.schoolId, (tx) => tx.select().from(plans));
    expect(rows.length).toBeGreaterThan(0);
    const denied = { cause: { code: '42501', message: expect.stringMatching(/permission denied/) } };
    await expect(withTenant(seed.a.schoolId, (tx) => tx.update(plans).set({ name: 'X' }))).rejects.toMatchObject(denied);
    await expect(withTenant(seed.a.schoolId, (tx) => tx.delete(plans))).rejects.toMatchObject(denied);
  });
});
