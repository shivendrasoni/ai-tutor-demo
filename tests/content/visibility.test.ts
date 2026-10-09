import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { contentExclusions, studentProfiles } from '@/db/schema';
import {
  listVisibleChapters,
  listVisibleSubjects,
  studentScope,
  visibleContent,
  type StudentScope,
} from '@/modules/content';
import { createBranch, createSection, createSubject } from '@/modules/tenancy';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { seedChunks, seedItem } from '../helpers/content';

let seed: Seed;
let scopeA1: StudentScope;
let a2: string;
let otherSection: string;
let scienceId: string;

const ids = async (s: StudentScope) => (await visibleContent(s)).map((i) => i.id);

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, seed.a.studentId)),
  );
  a2 = (await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'A2' })).id;
  otherSection = (await createSection(seed.a.schoolAdmin, { branchId: seed.a.branchId, grade: 8, name: 'other' })).id;
  scienceId = (await createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Science' })).id;
  scopeA1 = await studentScope(seed.a.student);
});

type Spec = {
  scope: 'school' | 'branch' | 'section';
  excludeFor?: 'A1' | 'A2';
  branch?: 'A1' | 'A2';
  section?: '8-A' | 'other';
  grade?: number;
  status?: string;
  school?: 'B';
};

describe('visibleContent', () => {
  it.each<[string, Spec, boolean]>([
    ['school item', { scope: 'school' }, true],
    ['school item excluded for this branch', { scope: 'school', excludeFor: 'A1' }, false],
    ['school item excluded for another branch only', { scope: 'school', excludeFor: 'A2' }, true],
    ['branch item in own branch', { scope: 'branch', branch: 'A1' }, true],
    ['branch item in another branch', { scope: 'branch', branch: 'A2' }, false],
    ['section item for own section', { scope: 'section', section: '8-A' }, true],
    ['section item for another section', { scope: 'section', section: 'other' }, false],
    ['wrong grade', { scope: 'school', grade: 9 }, false],
    ['queued', { scope: 'school', status: 'queued' }, false],
    ['processing', { scope: 'school', status: 'processing' }, false],
    ['failed', { scope: 'school', status: 'failed' }, false],
    ['other school, same grade', { scope: 'school', school: 'B' }, false],
  ])('%s', async (_n, spec, expected) => {
    const s = spec.school === 'B' ? seed.b : seed.a;
    const branchOf = (b: 'A1' | 'A2') => (b === 'A1' ? seed.a.branchId : a2);
    const overrides: Parameters<typeof seedItem>[1] = { scope: spec.scope, grade: spec.grade ?? 8 };
    if (spec.status) overrides.ingestStatus = spec.status;
    if (spec.scope !== 'school') overrides.branchId = branchOf(spec.branch ?? 'A1');
    if (spec.scope === 'section') overrides.sectionId = spec.section === 'other' ? otherSection : seed.a.sectionId;
    const { id } = await seedItem(s, overrides);
    if (spec.excludeFor) {
      await withPlatform((tx) =>
        tx.insert(contentExclusions).values({ schoolId: s.schoolId, branchId: branchOf(spec.excludeFor!), contentItemId: id }),
      );
    }
    expect((await ids(scopeA1)).includes(id)).toBe(expected);
  });

  it('branch swap: school book excluded + branch replacement shows only the replacement', async () => {
    const school = await seedItem(seed.a, { title: 'Swap school' });
    const repl = await seedItem(seed.a, { title: 'Swap branch', scope: 'branch', branchId: seed.a.branchId });
    await withPlatform((tx) =>
      tx.insert(contentExclusions).values({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, contentItemId: school.id }),
    );
    const v = await ids(scopeA1);
    expect(v).toContain(repl.id);
    expect(v).not.toContain(school.id);
  });

  it('a student with no section sees no section-scope material', async () => {
    const { id } = await seedItem(seed.a, { scope: 'section', branchId: seed.a.branchId, sectionId: seed.a.sectionId });
    expect(await ids({ ...scopeA1, sectionId: null })).not.toContain(id);
    expect(await ids(scopeA1)).toContain(id);
  });
});

describe('studentScope', () => {
  it('returns the profile scope for an active student', async () => {
    expect(scopeA1).toEqual({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, sectionId: seed.a.sectionId, grade: 8 });
  });

  it('pending, lapsed, removed, teacher, school_admin are FORBIDDEN', async () => {
    for (const status of ['pending_payment', 'lapsed', 'removed']) {
      await withPlatform((tx) => tx.update(studentProfiles).set({ status }).where(eq(studentProfiles.userId, seed.a.studentId)));
      await expect(studentScope(seed.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, seed.a.studentId)));
    await expect(studentScope(seed.a.teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(studentScope(seed.a.schoolAdmin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(studentScope(seed.platform)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('subject and chapter listings', () => {
  it('lists only subjects with a visible item; only chapters with chunks', async () => {
    const sci = await seedItem(seed.a, { subjectId: scienceId, title: 'Sci' });
    await seedChunks(sci.id, [{ title: 'Ch Cells', texts: ['cells divide'] }]);
    const hiddenSci = await seedItem(seed.a, { subjectId: scienceId, grade: 9, title: 'Sci9' });
    await seedChunks(hiddenSci.id, [{ title: 'Ch Hidden', texts: ['hidden'] }]);
    const subjects = await listVisibleSubjects(scopeA1);
    expect(subjects.map((s) => s.id)).toContain(scienceId);
    expect(subjects.map((s) => s.id)).toContain(seed.a.subjectId);
    const chapters = await listVisibleChapters(scopeA1, scienceId);
    expect(chapters.map((c) => c.title)).toEqual(['Ch Cells']);
    expect(await listVisibleChapters(scopeA1, 'not-a-uuid')).toEqual([]);
    expect(await listVisibleChapters(scopeA1, seed.b.subjectId)).toEqual([]);
  });

  it('listVisibleChapters excludes chapters without chunks', async () => {
    const empty = await seedItem(seed.a, { subjectId: scienceId, title: 'Empty' });
    await seedChunks(empty.id, [{ title: 'No chunks', texts: [] }]);
    expect((await listVisibleChapters(scopeA1, scienceId)).map((c) => c.title)).not.toContain('No chunks');
  });
});
