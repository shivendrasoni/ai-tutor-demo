import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { loadSchoolDashboard } from '@/app/(staff)/school/loaders';
import BranchCodes from '@/app/(staff)/school/_components/BranchCodes';
import EnrollmentTable from '@/app/(staff)/school/_components/EnrollmentTable';
import { InviteResult } from '@/app/(staff)/school/_components/AddStudentForm';
import StudentsTable from '@/app/(staff)/school/_components/StudentsTable';
import { createEmptySchool, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

describe('loadSchoolDashboard', () => {
  it('loader scopes by role and totals match the seed (Task 3 counts)', async () => {
    const sa = await loadSchoolDashboard(w.a.schoolAdmin, {});
    expect(sa.totals).toEqual({ pending: 2, active: 5, lapsed: 1, removed: 1 });
    expect(sa.canFilterBranch).toBe(true);
    const ba = await loadSchoolDashboard(w.a.branchAdmin, {});
    expect(ba.canFilterBranch).toBe(false);
    expect(ba.students.length).toBeGreaterThan(0);
    expect(ba.students.every((s) => s.branchId === w.a.branchId)).toBe(true);
    expect(ba.branches.map((b) => b.branchId)).toEqual([w.a.branchId]);
  });
  it('branch_admin forcing another branch through the query string is FORBIDDEN (Review Focus 4)', async () =>
    await expect(loadSchoolDashboard(w.a.branchAdmin, { branchId: w.aBranch2Id })).rejects.toMatchObject({ code: 'FORBIDDEN' }));
  it('bad grade/status params -> VALIDATION', async () => {
    for (const q of [{ grade: '4' }, { grade: '13' }, { grade: 'x' }, { grade: '8.5' }, { status: 'bogus' }]) {
      await expect(loadSchoolDashboard(w.a.schoolAdmin, q)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
  it('school_admin status filter returns only that status', async () => {
    const d = await loadSchoolDashboard(w.a.schoolAdmin, { status: 'lapsed' });
    expect(d.students.length).toBe(1);
    expect(d.students.every((s) => s.status === 'lapsed')).toBe(true);
  });
  it('school_admin branch + grade filter narrows students and summary', async () => {
    const d = await loadSchoolDashboard(w.a.schoolAdmin, { branchId: w.aBranch2Id, grade: '9' });
    expect(d.students.every((s) => s.branchId === w.aBranch2Id && s.grade === 9)).toBe(true);
    expect(d.summary.every((r) => r.branchId === w.aBranch2Id)).toBe(true);
  });
  it('empty school: loader returns empty collections and the components render empty states (Review Focus 1)', async () => {
    const empty = await createEmptySchool(w.platform);
    const d = await loadSchoolDashboard(empty.admin, {});
    expect(d.totals).toEqual({ pending: 0, active: 0, lapsed: 0, removed: 0 });
    expect(d.students).toEqual([]);
    expect(d.branches).toEqual([]);
    const html = renderToStaticMarkup(
      <>
        <EnrollmentTable rows={d.summary} />
        <StudentsTable rows={d.students} canRemove />
        <BranchCodes branches={d.branches} />
      </>,
    );
    expect(html).toContain('No students yet');
    expect(html).toContain('No branches yet');
  });
});

describe('components', () => {
  const row = {
    userId: 'u1', name: 'Riya', username: 'riya1', branchId: 'b', branchName: 'Branch A', grade: 8,
    sectionName: '8-A', status: 'active' as const, planName: 'Monthly', periodEnd: new Date('2026-11-01T00:00:00Z'),
  };
  it('StudentsTable shows status badge, plan and period end; Remove only when canRemove', () => {
    const on = renderToStaticMarkup(<StudentsTable rows={[row]} canRemove />);
    for (const s of ['Riya', 'riya1', 'active', 'Monthly', '2026-11-01', '8-A']) expect(on).toContain(s);
    expect(on).toContain('Remove');
    expect(renderToStaticMarkup(<StudentsTable rows={[row]} canRemove={false} />)).not.toContain('Remove');
  });
  it('StudentsTable offers "New invite link" only to pending students who have not signed up', () => {
    const pending = { ...row, status: 'pending_payment' as const, username: null };
    expect(renderToStaticMarkup(<StudentsTable rows={[pending]} canRemove />)).toContain('New invite link');
    expect(renderToStaticMarkup(<StudentsTable rows={[{ ...pending, username: 'kid1' }]} canRemove />)).not.toContain('New invite link');
    expect(renderToStaticMarkup(<StudentsTable rows={[row]} canRemove />)).not.toContain('New invite link');
    expect(renderToStaticMarkup(<StudentsTable rows={[pending]} canRemove={false} />)).not.toContain('New invite link');
  });
  it('AddStudentForm result view shows the invite link', () => {
    const html = renderToStaticMarkup(<InviteResult url="https://x.test/invite/abc" />);
    expect(html).toContain('https://x.test/invite/abc');
    expect(html).toContain('Copy');
  });
  it('BranchCodes lists codes with actions', () => {
    const html = renderToStaticMarkup(
      <BranchCodes branches={[{ branchId: 'b', name: 'Branch A', signupCode: 'ABC123', signupCodeEnabled: true, sections: [] }]} />,
    );
    for (const s of ['Branch A', 'ABC123', 'Rotate', 'Disable']) expect(html).toContain(s);
  });
});
