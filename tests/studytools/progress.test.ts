import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { attempts, branches, memberships, sections, studentProfiles, subjects, teacherAssignments, users } from '@/db/schema';
import { chapterProgress, type ChapterProgressRow } from '@/modules/studytools/progress';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, insertArtifact } from '../helpers/study';

const CH1 = '00000000-0000-4000-8000-0000000000a1';
const CH2 = '00000000-0000-4000-8000-0000000000a2';
let seed: Seed;
let S1: string;
let S2: string;
let s1: string;
let s2: string; // 8-B, same branch
let s3: string; // other branch of school A
let sB: string;
let s1Actor: Actor;
let branchAdmin2: Actor;

const actorOf = (userId: string, schoolId: string, branchId: string | null, role: Actor['roles'][number]): Actor => ({
  userId, isPlatformAdmin: false, schoolId, branchId, roles: [role],
});
const rowFor = (rows: ChapterProgressRow[], student: string, ch: string, subject?: string) =>
  rows.find((r) => r.studentId === student && r.chapterId === ch && (!subject || r.subjectId === subject));

async function graded(
  schoolId: string, student: string, subject: string, byChapter: Record<string, { scored: number; max: number }> | null,
  o: { status?: string; titles?: Record<string, string>; createdAt?: Date } = {},
) {
  const art = await insertArtifact(schoolId, student, subject, {
    params: { chapterTitles: o.titles ?? { [CH1]: 'Chapter 1: Real Numbers', [CH2]: 'Chapter 2: Polynomials' } },
    ...(o.createdAt ? { createdAt: o.createdAt } : {}),
  });
  await withPlatform((tx) =>
    tx.insert(attempts).values({ schoolId, artifactId: art.id, studentId: student, status: o.status ?? 'graded', byChapter }),
  );
}

async function mkStudent(schoolId: string, branchId: string, sectionId: string, name: string): Promise<string> {
  return withPlatform(async (tx) => {
    const [u] = await tx.insert(users).values({ username: name, name, passwordHash: 'x' }).returning();
    await tx.insert(memberships).values({ userId: u.id, schoolId, branchId, role: 'student' });
    await tx.insert(studentProfiles).values({
      userId: u.id, schoolId, branchId, grade: 8, sectionId, parentName: 'P', parentPhone: '9999999999', status: 'active',
    });
    return u.id;
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  const a = seed.a;
  await activateStudent(a.student);
  S1 = a.subjectId;
  s1 = a.studentId;
  s1Actor = a.student;
  const fx = await withPlatform(async (tx) => {
    const [sec8b] = await tx.insert(sections).values({ schoolId: a.schoolId, branchId: a.branchId, grade: 8, name: '8-B' }).returning();
    const [sub2] = await tx.insert(subjects).values({ schoolId: a.schoolId, name: 'Science' }).returning();
    const [br2] = await tx.insert(branches).values({ schoolId: a.schoolId, name: 'Branch A2', signupCode: 'ZZZZ2222' }).returning();
    const [sec2] = await tx.insert(sections).values({ schoolId: a.schoolId, branchId: br2.id, grade: 8, name: '8-A' }).returning();
    const [bu] = await tx.insert(users).values({ username: 'ba2_admin', name: 'BA2', passwordHash: 'x' }).returning();
    await tx.insert(memberships).values({ userId: bu.id, schoolId: a.schoolId, branchId: br2.id, role: 'branch_admin' });
    return { sec8b, sub2, br2, sec2, bu };
  });
  S2 = fx.sub2.id;
  s2 = await mkStudent(a.schoolId, a.branchId, fx.sec8b.id, 'prog_s2');
  s3 = await mkStudent(a.schoolId, fx.br2.id, fx.sec2.id, 'prog_s3');
  sB = seed.b.studentId;
  branchAdmin2 = actorOf(fx.bu.id, a.schoolId, fx.br2.id, 'branch_admin');
  // teacher assigned to 8-A / S1 only (seed). Extra assignment for 8-A / S2 is deliberately absent.

  // s1: S1 ch1 twice graded (2/3 + 3/3), ch2 once; grading + in_progress + null by_chapter ignored; S2 ch1 once
  await graded(a.schoolId, s1, S1, { [CH1]: { scored: 2, max: 3 } }, { createdAt: new Date('2026-10-01T00:00:00Z') });
  await graded(a.schoolId, s1, S1, { [CH1]: { scored: 3, max: 3 }, [CH2]: { scored: 1.5, max: 2 } }, {
    createdAt: new Date('2026-10-05T00:00:00Z'),
    titles: { [CH1]: 'Chapter 1: Real Numbers', [CH2]: 'Chapter 2: Polynomials' },
  });
  await graded(a.schoolId, s1, S1, { [CH1]: { scored: 9, max: 9 } }, { status: 'grading' });
  await graded(a.schoolId, s1, S1, { [CH1]: { scored: 9, max: 9 } }, { status: 'in_progress' });
  await graded(a.schoolId, s1, S1, null);
  await graded(a.schoolId, s1, S2, { [CH1]: { scored: 4, max: 5 } });
  // s2 (8-B, unassigned), s3 (other branch), school B student
  await graded(a.schoolId, s2, S1, { [CH1]: { scored: 1, max: 4 } });
  await graded(a.schoolId, s3, S1, { [CH1]: { scored: 2, max: 4 } });
  await graded(seed.b.schoolId, sB, seed.b.subjectId, { [CH1]: { scored: 7, max: 7 } });
});

const ids = (rows: ChapterProgressRow[]) => new Set(rows.map((r) => r.studentId));

describe('chapterProgress', () => {
  it('sums by_chapter over graded attempts only, ignoring in_progress, grading and null', async () => {
    const rows = await chapterProgress(s1Actor, {});
    expect(rowFor(rows, s1, CH1, S1)).toMatchObject({ scored: 5, max: 6, attempts: 2 });
    expect(rowFor(rows, s1, CH2, S1)).toMatchObject({ scored: 1.5, max: 2, attempts: 1 });
    expect(rowFor(rows, s1, CH1, S2)).toMatchObject({ scored: 4, max: 5, attempts: 1 });
    expect(rows).toHaveLength(3);
  });
  it('student sees only themselves, even when asking for another id', async () => {
    const rows = await chapterProgress(s1Actor, { studentIds: [s1, s2, sB] });
    expect(ids(rows)).toEqual(new Set([s1]));
  });
  it('teacher sees only assigned section + subject', async () => {
    const rows = await chapterProgress(seed.a.teacher, {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.studentId === s1 && r.subjectId === S1)).toBe(true);
  });
  it('subjectId and studentIds filters narrow', async () => {
    const rows = await chapterProgress(seed.a.schoolAdmin, { subjectId: S2 });
    expect(rows.map((r) => [r.studentId, r.subjectId])).toEqual([[s1, S2]]);
    const one = await chapterProgress(seed.a.schoolAdmin, { studentIds: [s2] });
    expect(ids(one)).toEqual(new Set([s2]));
    expect(await chapterProgress(seed.a.schoolAdmin, { studentIds: [] })).toEqual([]);
    expect(await chapterProgress(seed.a.schoolAdmin, { studentIds: ['not-a-uuid'] })).toEqual([]);
    expect(await chapterProgress(seed.a.teacher, { subjectId: S2 })).toEqual([]);
  });
  it('branch_admin sees own branch only; school_admin sees the school; never school B', async () => {
    expect(ids(await chapterProgress(seed.a.branchAdmin, {}))).toEqual(new Set([s1, s2]));
    expect(ids(await chapterProgress(branchAdmin2, {}))).toEqual(new Set([s3]));
    expect(ids(await chapterProgress(seed.a.schoolAdmin, {}))).toEqual(new Set([s1, s2, s3]));
    expect(ids(await chapterProgress(seed.b.schoolAdmin, {}))).toEqual(new Set([sB]));
    expect(ids(await chapterProgress(seed.a.schoolAdmin, { studentIds: [sB] }))).toEqual(new Set());
  });
  it('platform admin and roleless actors are FORBIDDEN', async () => {
    await expect(chapterProgress(seed.platform, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(chapterProgress({ ...seed.a.schoolAdmin, roles: [] }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(chapterProgress({ ...seed.a.schoolAdmin, schoolId: null, roles: [] }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rows are sorted deterministically (student, subject, chapter)', async () => {
    const rows = await chapterProgress(seed.a.schoolAdmin, {});
    const key = (r: ChapterProgressRow) => [r.studentId, r.subjectId, r.chapterId].join('|');
    expect(rows.map(key)).toEqual([...rows.map(key)].sort());
  });
  it('uses the newest artifact title for the same chapter', async () => {
    await graded(seed.a.schoolId, s2, S1, { [CH1]: { scored: 1, max: 1 } }, {
      createdAt: new Date('2099-01-01T00:00:00Z'), titles: { [CH1]: 'Renamed Chapter 1' },
    });
    await graded(seed.a.schoolId, s2, S1, { [CH1]: { scored: 1, max: 1 } }, {
      createdAt: new Date('2026-10-02T00:00:00Z'), titles: { [CH1]: 'Old Chapter 1' },
    });
    expect(rowFor(await chapterProgress(seed.a.schoolAdmin, {}), s2, CH1, S1)).toMatchObject({ chapterTitle: 'Renamed Chapter 1', attempts: 3 });
  });
  it('deleted chapters keep their snapshot title', async () => {
    await withPlatform((tx) => tx.execute(sql`delete from content_items`));
    expect(rowFor(await chapterProgress(s1Actor, {}), s1, CH1, S1)?.chapterTitle).toBe('Chapter 1: Real Numbers');
  });
  it('numeric columns are numbers, not strings', async () => {
    const rows = await chapterProgress(s1Actor, {});
    expect(typeof rows[0]!.scored).toBe('number');
    expect(typeof rows[0]!.max).toBe('number');
    expect(typeof rows[0]!.attempts).toBe('number');
  });
});
