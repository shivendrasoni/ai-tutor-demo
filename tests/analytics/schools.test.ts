import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { listSchools, platformOverview } from '@/modules/analytics';
import { listPendingSubscriptions } from '@/modules/enrollment';
import { createEmptySchool, insertMessage, insertUsageDaily, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
const now = new Date('2027-03-10T12:00:00Z');
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

describe('listSchools', () => {
  it('nests branches with codes; a school with no branches has []', async () => {
    const empty = await createEmptySchool(w.platform);
    const r = await listSchools(w.platform);
    expect(r.map((s) => s.name)).toEqual([...r.map((s) => s.name)].sort());
    const a = r.find((s) => s.id === w.a.schoolId)!;
    expect(a.branches).toHaveLength(2);
    expect(a.branches.map((b) => b.name)).toEqual([...a.branches.map((b) => b.name)].sort());
    expect(a.branches[0]).toMatchObject({ signupCode: expect.any(String), signupCodeEnabled: expect.any(Boolean) });
    expect(r.find((s) => s.id === empty.schoolId)).toMatchObject({ branches: [], board: 'CBSE' });
  });
});

describe('platformOverview', () => {
  it('counts pending, open flags and 30d cost', async () => {
    const base = { schoolId: w.a.schoolId, studentId: w.a.student.userId, createdAt: new Date('2027-03-10T09:00:00Z') };
    const f1 = await insertMessage({ ...base, role: 'user', flagged: true });
    await insertMessage({ ...base, role: 'user', flagged: true });
    await insertMessage({ ...base, role: 'user' });
    const { markReviewed } = await import('@/modules/analytics');
    await markReviewed(w.platform, f1);
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.a.student.userId, date: '2027-03-10', tokens: 1, cost: 0.5 });
    await insertUsageDaily({ schoolId: w.b.schoolId, studentId: w.b.student.userId, date: '2027-03-09', tokens: 1, cost: 0.25 });
    const o = await platformOverview(w.platform, { now });
    expect(o.pendingPayments).toBe((await listPendingSubscriptions(w.platform)).length);
    expect(o.pendingPayments).toBeGreaterThan(0);
    expect(o.openFlags).toBe(1);
    expect(o.cost30d).toBeCloseTo(0.75);
  });

  it('on a platform with no schools/flags/pending returns zeros (Review Focus 1)', async () => {
    await resetDb();
    const { withPlatform } = await import('@/db/client');
    const { users } = await import('@/db/schema');
    const [pu] = await withPlatform((tx) =>
      tx.insert(users).values({ username: 'p_only', name: 'P', isPlatformAdmin: true, passwordHash: 'x' }).returning());
    const platform = { userId: pu.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] as never[] };
    expect(await platformOverview(platform, { now })).toEqual({ pendingPayments: 0, openFlags: 0, cost30d: 0 });
    expect(await listSchools(platform)).toEqual([]);
  });
});
