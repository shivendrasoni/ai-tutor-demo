import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { canManageBranch, canManageSchool, runAs } from '@/modules/tenancy/authz';
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
});

afterAll(async () => {
  await closeDb();
});
