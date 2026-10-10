import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { enrollmentSummary, listBranches } from '@/modules/analytics';
import { createEmptySchool, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

type Rows = Awaited<ReturnType<typeof enrollmentSummary>>;
const row = (rows: Rows, branchId: string, grade: number) => rows.find((r) => r.branchId === branchId && r.grade === grade);

describe('enrollmentSummary', () => {
  it('school_admin A gets exact counts per branch and grade', async () => {
    const rows = await enrollmentSummary(w.a.schoolAdmin, {});
    expect(row(rows, w.a.branchId, 8)).toMatchObject({ pending: 1, active: 2, lapsed: 1, removed: 1 });
    expect(row(rows, w.a.branchId, 9)).toMatchObject({ pending: 0, active: 1, lapsed: 0, removed: 0 });
    expect(row(rows, w.aBranch2Id, 8)).toMatchObject({ pending: 1, active: 0 });
    expect(row(rows, w.aBranch2Id, 9)).toMatchObject({ active: 2 });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.branchId !== w.b.branchId)).toBe(true);
  });
  it('orders by branchName, grade and includes branchName', async () => {
    const rows = await enrollmentSummary(w.a.schoolAdmin, {});
    expect(rows.map((r) => `${r.branchName}/${r.grade}`)).toEqual(['Branch A/8', 'Branch A/9', 'Branch A2/8', 'Branch A2/9']);
  });
  it('school_admin may pass their own schoolId', async () => {
    expect(await enrollmentSummary(w.a.schoolAdmin, { schoolId: w.a.schoolId })).toHaveLength(4);
  });
  it('branch_admin sees only own branch; passing schoolId is FORBIDDEN', async () => {
    const rows = await enrollmentSummary(w.a.branchAdmin, {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branchId === w.a.branchId)).toBe(true);
    await expect(enrollmentSummary(w.a.branchAdmin, { schoolId: w.a.schoolId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('platform needs schoolId; teacher/student FORBIDDEN; school_admin A cannot pass B', async () => {
    await expect(enrollmentSummary(w.platform, {})).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await enrollmentSummary(w.platform, { schoolId: w.b.schoolId })).reduce((n, r) => n + r.active, 0)).toBe(3);
    await expect(enrollmentSummary(w.a.teacher, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(enrollmentSummary(w.a.student, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(enrollmentSummary(w.a.schoolAdmin, { schoolId: w.b.schoolId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('malformed schoolId is FORBIDDEN/VALIDATION, never a 500', async () => {
    await expect(enrollmentSummary(w.a.schoolAdmin, { schoolId: 'nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(enrollmentSummary(w.platform, { schoolId: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('a school with no students or branches returns [] (Review Focus 1)', async () => {
    const empty = await createEmptySchool(w.platform);
    expect(await enrollmentSummary(empty.admin, {})).toEqual([]);
    expect(await listBranches(empty.admin)).toEqual([]);
  });
});

describe('listBranches', () => {
  it('school_admin all, branch_admin own, teacher/student FORBIDDEN', async () => {
    const all = await listBranches(w.a.schoolAdmin);
    expect(all.map((b) => b.name)).toEqual(['Branch A', 'Branch A2']);
    const a1 = all.find((b) => b.branchId === w.a.branchId)!;
    expect(a1.signupCodeEnabled).toBe(true);
    expect(a1.signupCode).toBe(w.a.code);
    expect(a1.sections.map((s) => `${s.grade}-${s.name}`)).toEqual(['8-8-A', '9-9-A']);
    const own = await listBranches(w.a.branchAdmin);
    expect(own.map((b) => b.branchId)).toEqual([w.a.branchId]);
    await expect(listBranches(w.a.teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listBranches(w.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
