import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { assert, canManageBranch, canManageSchool, requirePlatform, runAs } from '@/modules/tenancy/authz';
import type { Actor } from '@/modules/tenancy/actor';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});

describe('authz matrix', () => {
  const cases: [string, (s: Seed) => Actor, boolean, boolean, boolean][] = [
    ['platform', (s) => s.platform, true, true, true],
    ['school_admin A', (s) => s.a.schoolAdmin, true, true, true],
    ['branch_admin A1', (s) => s.a.branchAdmin, false, true, false],
    ['teacher A1', (s) => s.a.teacher, false, false, false],
    ['student A1', (s) => s.a.student, false, false, false],
    ['school_admin B', (s) => s.b.schoolAdmin, false, false, false],
  ];
  it.each(cases)('%s', (_n, pick, school, a1, a2) => {
    const actor = pick(seed);
    expect(canManageSchool(actor, seed.a.schoolId)).toBe(school);
    expect(canManageBranch(actor, seed.a.schoolId, seed.a.branchId)).toBe(a1);
    expect(canManageBranch(actor, seed.a.schoolId, randomUUID())).toBe(a2);
  });
});

describe('runAs', () => {
  it('rejects non-platform actor with null schoolId as FORBIDDEN', async () => {
    const actor: Actor = { userId: randomUUID(), isPlatformAdmin: false, schoolId: null, branchId: null, roles: [] };
    await expect(runAs(actor, async () => 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('scopes a tenant actor to its school and lets a platform actor see all', async () => {
    const count = (tx: import('@/db/client').Tx) =>
      tx.execute(sql`select count(*)::int as n from schools`).then((r) => (r.rows[0] as { n: number }).n);
    expect(await runAs(seed.a.schoolAdmin, count)).toBe(1);
    expect(await runAs(seed.platform, count)).toBe(2);
  });
});

describe('requirePlatform / assert', () => {
  it('requirePlatform passes for platform admin and throws FORBIDDEN otherwise', () => {
    expect(() => requirePlatform(seed.platform)).not.toThrow();
    expect(() => requirePlatform(seed.a.schoolAdmin)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it('assert throws FORBIDDEN only when the condition is false', () => {
    expect(() => assert(true)).not.toThrow();
    expect(() => assert(false)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

afterAll(async () => {
  await closeDb();
});
