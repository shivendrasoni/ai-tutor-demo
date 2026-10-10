import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { currentCode, resetDb, seedTwoSchools, type Seed } from '../helpers/db';

const gen = vi.hoisted(() => ({ queue: [] as string[] }));
vi.mock('@/modules/tenancy/codes', async (orig) => {
  const real = await orig<typeof import('@/modules/tenancy/codes')>();
  return { ...real, generateBranchCode: () => gen.queue.shift() ?? real.generateBranchCode() };
});

import { createBranch, rotateBranchCode } from '@/modules/tenancy';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  gen.queue = [];
});
afterAll(closeDb);

describe('signup_code collision retry', () => {
  it('createBranch retries after collisions and succeeds within 5 attempts', async () => {
    gen.queue = [seed.a.code, seed.a.code, seed.a.code, seed.a.code, 'FRESH234'];
    const r = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Retry' });
    expect(r.signupCode).toBe('FRESH234');
  });

  it('createBranch gives up after 5 colliding attempts', async () => {
    gen.queue = Array(5).fill(seed.a.code);
    await expect(createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Retry' })).rejects.toBeTruthy();
    expect(gen.queue).toHaveLength(0);
  });

  it('rotateBranchCode retries after a collision', async () => {
    const other = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Other' });
    gen.queue = [other.signupCode, 'ROTATE23'];
    expect(await rotateBranchCode(seed.a.schoolAdmin, seed.a.branchId)).toBe('ROTATE23');
    expect(await currentCode(seed.a.branchId)).toBe('ROTATE23');
  });
});
