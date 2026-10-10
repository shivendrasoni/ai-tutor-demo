import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { loadTeacherDashboard } from '@/app/(staff)/teacher/loaders';
import ProgressGrid from '@/app/(staff)/teacher/_components/ProgressGrid';
import SectionSelector from '@/app/(staff)/teacher/_components/SectionSelector';
import UsageTable from '@/app/(staff)/teacher/_components/UsageTable';
import { createStaffUser } from '@/modules/tenancy';
import type { Actor } from '@/modules/tenancy';
import { seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

describe('loadTeacherDashboard', () => {
  it('loader defaults to first assignment; unassigned selection FORBIDDEN', async () => {
    const d = await loadTeacherDashboard(w.a.teacher, {});
    expect(d.assignments).toHaveLength(1);
    expect(d.selected).toEqual({ sectionId: w.a.sectionId, subjectId: w.a.subjectId });
    expect(d.progress).not.toBeNull();
    expect(d.usage.length).toBeGreaterThan(0);
    await expect(
      loadTeacherDashboard(w.a.teacher, { sectionId: w.aSection9Id, subjectId: w.a.subjectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      loadTeacherDashboard(w.a.teacher, { sectionId: w.a.sectionId, subjectId: w.aSubject2Id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('a half-specified selection is VALIDATION', async () =>
    await expect(loadTeacherDashboard(w.a.teacher, { sectionId: w.a.sectionId })).rejects.toMatchObject({ code: 'VALIDATION' }));
  it('teacher with no assignments gets selected null; selector renders "No classes assigned yet" (Review Focus 1)', async () => {
    const { userId } = await createStaffUser(w.platform, {
      schoolId: w.a.schoolId, branchId: w.a.branchId, role: 'teacher', username: 'idle_teacher',
      password: 'correct-horse', name: 'Idle',
    });
    const idle: Actor = { userId, isPlatformAdmin: false, schoolId: w.a.schoolId, branchId: w.a.branchId, roles: ['teacher'] };
    const d = await loadTeacherDashboard(idle, {});
    expect(d.selected).toBeNull();
    expect(d.progress).toBeNull();
    expect(d.usage).toEqual([]);
    expect(renderToStaticMarkup(<SectionSelector assignments={d.assignments} selected={d.selected} />)).toContain('No classes assigned yet');
  });
});

describe('components', () => {
  const fixture = {
    chapters: [
      { chapterId: 'c1', title: 'Fractions', avgRatio: 0.4, weak: true },
      { chapterId: 'c2', title: 'Decimals', avgRatio: 0.73, weak: false },
    ],
    students: [
      { studentId: 's1', name: 'Riya', chapters: [{ chapterId: 'c1', ratio: null, attempts: 0 }, { chapterId: 'c2', ratio: 0.73, attempts: 2 }] },
    ],
  };
  it('ProgressGrid highlights weak headers and renders pct / "—"', () => {
    const html = renderToStaticMarkup(<ProgressGrid data={fixture} />);
    expect(html).toContain('73%');
    expect(html).toContain('—');
    expect(html).toMatch(/data-weak="true"/);
    expect(html.match(/data-weak="true"/g)).toHaveLength(1);
  });
  it('ProgressGrid with no students renders the empty state', () => {
    expect(renderToStaticMarkup(<ProgressGrid data={{ ...fixture, students: [] }} />)).toContain('No students in this section yet');
  });
  it('SectionSelector links each assignment and marks the selected one', () => {
    const a = { sectionId: 's', sectionName: '8-A', grade: 8, subjectId: 'x', subjectName: 'Maths' };
    const html = renderToStaticMarkup(<SectionSelector assignments={[a]} selected={{ sectionId: 's', subjectId: 'x' }} />);
    expect(html).toContain('sectionId=s');
    expect(html).toContain('aria-current');
    expect(html).toContain('Maths');
  });
  it('UsageTable renders rows and an empty state', () => {
    const r = { studentId: 's', name: 'Riya', sectionName: '8-A', messages7d: 3, messages30d: 9, lastActiveAt: null };
    const html = renderToStaticMarkup(<UsageTable rows={[r]} />);
    for (const s of ['Riya', '9', '—']) expect(html).toContain(s);
    expect(renderToStaticMarkup(<UsageTable rows={[]} />)).toContain('No usage yet');
  });
});
