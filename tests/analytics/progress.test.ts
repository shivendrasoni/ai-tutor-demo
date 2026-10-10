import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { contentExclusions, contentItems, sections, subjects } from '@/db/schema';
import { listTeacherAssignments, sectionProgress } from '@/modules/analytics';
import { insertChapter, insertGradedAttempt, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const ch = (title: string) =>
  insertChapter({ schoolId: w.a.schoolId, branchId: w.a.branchId, subjectId: w.a.subjectId, grade: 8, title });
const run = (actor = w.a.teacher) => sectionProgress(actor, { sectionId: w.a.sectionId, subjectId: w.a.subjectId });
const att = (studentId: string, byChapter: Record<string, { scored: number; max: number }>) =>
  insertGradedAttempt({ schoolId: w.a.schoolId, studentId, subjectId: w.a.subjectId, byChapter });

describe('sectionProgress', () => {
  it('weak flag flips at 0.49 vs 0.50 (strict < 0.5)', async () => {
    const c1 = (await ch('C1')).chapterId;
    const c2 = (await ch('C2')).chapterId;
    await att(w.aActive1.userId, { [c1]: { scored: 49, max: 100 } });
    await att(w.aActive1.userId, { [c2]: { scored: 50, max: 100 } });
    const r = await run();
    expect(r.chapters.find((c) => c.chapterId === c1)).toMatchObject({ avgRatio: 0.49, weak: true });
    expect(r.chapters.find((c) => c.chapterId === c2)).toMatchObject({ avgRatio: 0.5, weak: false });
  });
  it('pools across students; student without attempts has null ratio and 0 attempts', async () => {
    const c3 = (await ch('C3')).chapterId;
    await att(w.aActive1.userId, { [c3]: { scored: 0, max: 10 } });
    await att(w.aActive2.userId, { [c3]: { scored: 5, max: 5 } });
    const r = await run();
    const row = r.chapters.find((c) => c.chapterId === c3)!;
    expect(row.title).toBe('C3');
    expect(row.avgRatio).toBeCloseTo(1 / 3, 10); // pooled 5/15, not the mean of ratios (0.5)
    expect(row.weak).toBe(true);
    const s1 = r.students.find((s) => s.studentId === w.aActive1.userId)!;
    expect(s1.chapters.find((c) => c.chapterId === c3)).toMatchObject({ ratio: 0, attempts: 1 });
    const lapsed = r.students.find((s) => s.studentId === w.aLapsedId)!;
    expect(lapsed.chapters.find((c) => c.chapterId === c3)).toEqual({ chapterId: c3, ratio: null, attempts: 0 });
  });
  it('excludes removed students from roster and pooled average', async () => {
    const c = (await ch('C4')).chapterId;
    await att(w.aActive1.userId, { [c]: { scored: 8, max: 10 } });
    await att(w.aRemovedId, { [c]: { scored: 0, max: 10 } });
    const r = await run();
    expect(r.students.map((s) => s.studentId)).not.toContain(w.aRemovedId);
    expect(r.chapters.find((x) => x.chapterId === c)!.avgRatio).toBe(0.8);
  });
  it('a chapter with no attempts has avgRatio null and is never weak', async () => {
    const c = (await ch('C5')).chapterId;
    const r = await run();
    expect(r.chapters.find((x) => x.chapterId === c)).toMatchObject({ avgRatio: null, weak: false });
  });
  it('max = 0 yields null ratio, not NaN', async () => {
    const c = (await ch('C6')).chapterId;
    await att(w.aActive1.userId, { [c]: { scored: 0, max: 0 } });
    const r = await run();
    expect(r.chapters.find((x) => x.chapterId === c)).toMatchObject({ avgRatio: null, weak: false });
    expect(r.students.find((s) => s.studentId === w.aActive1.userId)!.chapters.find((x) => x.chapterId === c)!.ratio).toBeNull();
  });
  it('teacher unassigned to section or to the subject is FORBIDDEN', async () => {
    const other = await withPlatform(async (tx) =>
      (await tx.insert(subjects).values({ schoolId: w.a.schoolId, name: 'History' }).returning())[0].id);
    await expect(sectionProgress(w.a.teacher, { sectionId: w.aSection9Id, subjectId: w.a.subjectId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(sectionProgress(w.a.teacher, { sectionId: w.a.sectionId, subjectId: other })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('branch_admin A1 allowed on own section, FORBIDDEN on A2; school_admin allowed on both', async () => {
    await expect(run(w.a.branchAdmin)).resolves.toBeTruthy();
    await expect(sectionProgress(w.a.branchAdmin, { sectionId: w.aSection2Id, subjectId: w.a.subjectId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(w.a.schoolAdmin)).resolves.toBeTruthy();
    await expect(sectionProgress(w.a.schoolAdmin, { sectionId: w.aSection2Id, subjectId: w.a.subjectId })).resolves.toBeTruthy();
  });
  it('students, platform admins and other schools are FORBIDDEN; missing section is NOT_FOUND', async () => {
    await expect(run(w.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(w.platform)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(w.b.schoolAdmin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      sectionProgress(w.a.schoolAdmin, { sectionId: '00000000-0000-4000-8000-000000000000', subjectId: w.a.subjectId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('empty section (no students, no chapters) returns empty arrays (Review Focus 1)', async () => {
    const [empty] = await withPlatform((tx) =>
      tx.insert(sections).values({ schoolId: w.a.schoolId, branchId: w.a.branchId, grade: 10, name: '10-A' }).returning());
    expect(await sectionProgress(w.a.schoolAdmin, { sectionId: empty.id, subjectId: w.a.subjectId })).toEqual({ students: [], chapters: [] });
  });
});

describe('sectionProgress chapter visibility', () => {
  const ids = async () => (await run(w.a.schoolAdmin)).chapters.map((c) => c.chapterId);
  it('section-scope chapter shows for its own section, not a sibling section', async () => {
    const [sib] = await withPlatform((tx) =>
      tx.insert(sections).values({ schoolId: w.a.schoolId, branchId: w.a.branchId, grade: 8, name: '8-B' }).returning());
    const c = await insertChapter({ schoolId: w.a.schoolId, branchId: w.a.branchId, sectionId: w.a.sectionId, subjectId: w.a.subjectId, grade: 8, title: 'Own' });
    expect(await ids()).toContain(c.chapterId);
    const r = await sectionProgress(w.a.schoolAdmin, { sectionId: sib.id, subjectId: w.a.subjectId });
    expect(r.chapters).toEqual([]);
  });
  it('school-scope item excluded for the branch is not listed', async () => {
    const c = await ch('Excluded');
    await withPlatform((tx) =>
      tx.insert(contentExclusions).values({ schoolId: w.a.schoolId, branchId: w.a.branchId, contentItemId: c.contentItemId }));
    expect(await ids()).not.toContain(c.chapterId);
  });
  it('branch-scope item of another branch is not listed', async () => {
    const c = await insertChapter({ schoolId: w.a.schoolId, branchId: w.aBranch2Id, branchScope: true, subjectId: w.a.subjectId, grade: 8, title: 'Other' });
    expect(await ids()).not.toContain(c.chapterId);
    const own = await insertChapter({ schoolId: w.a.schoolId, branchId: w.a.branchId, branchScope: true, subjectId: w.a.subjectId, grade: 8, title: 'Mine' });
    expect(await ids()).toContain(own.chapterId);
  });
  it('a chapter with graded attempts that is no longer visible is omitted', async () => {
    const c = await ch('Gone');
    await att(w.aActive1.userId, { [c.chapterId]: { scored: 1, max: 10 } });
    await withPlatform((tx) => tx.update(contentItems).set({ ingestStatus: 'failed' }).where(eq(contentItems.id, c.contentItemId)));
    const r = await run();
    expect(r.chapters.map((x) => x.chapterId)).not.toContain(c.chapterId);
    expect(r.students.find((s) => s.studentId === w.aActive1.userId)!.chapters).toEqual([]);
  });
});

describe('listTeacherAssignments', () => {
  it("returns the teacher's rows only, ordered; admins and students FORBIDDEN", async () => {
    expect(await listTeacherAssignments(w.a.teacher)).toEqual([
      { sectionId: w.a.sectionId, sectionName: '8-A', grade: 8, subjectId: w.a.subjectId, subjectName: 'Mathematics' },
    ]);
    expect(await listTeacherAssignments(w.b.teacher)).toHaveLength(1);
    for (const a of [w.a.schoolAdmin, w.a.branchAdmin, w.a.student, w.platform]) {
      await expect(listTeacherAssignments(a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
