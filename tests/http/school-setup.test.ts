import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { sections, subjects, teacherAssignments, users } from '@/db/schema';
import { createSession, login } from '@/modules/tenancy';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

import * as sectionsRoute from '@/app/api/school/sections/route';
import * as subjectsRoute from '@/app/api/school/subjects/route';
import * as teachersRoute from '@/app/api/school/teachers/route';
import * as assignmentsRoute from '@/app/api/school/assignments/route';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

const sid = async (userId: string) => `sid=${await createSession(userId)}`;
function post(handler: (r: Request) => Promise<Response>, cookie: string | undefined, body: unknown, raw = false) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  return handler(new Request('http://localhost/x', { method: 'POST', headers, body: raw ? (body as string) : JSON.stringify(body) }));
}
const errCode = async (res: Response) => (await res.json()).error.code as string;
const UUID0 = '00000000-0000-4000-8000-000000000000';

describe('POST /api/school/sections', () => {
  it('school_admin creates a section in any branch of their school; 201 {id}', async () => {
    const res = await post(sectionsRoute.POST, await sid(seed.a.schoolAdmin.userId!), { branchId: seed.a.branchId, grade: 9, name: ' 9-A ' });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [row] = await withPlatform((tx) => tx.select().from(sections).where(eq(sections.id, id)));
    expect(row).toMatchObject({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, grade: 9, name: '9-A' });
  });
  it('branch_admin only for their own branch', async () => {
    const cookie = await sid(seed.a.branchAdmin.userId!);
    expect((await post(sectionsRoute.POST, cookie, { branchId: seed.a.branchId, grade: 10, name: '10-A' })).status).toBe(201);
    expect((await post(sectionsRoute.POST, cookie, { branchId: seed.b.branchId, grade: 10, name: '10-A' })).status).toBe(404);
  });
  it('401 anonymous, 403 teacher/student, 400 bad body/grade/duplicate, 404 malformed or unknown branch', async () => {
    const body = { branchId: seed.a.branchId, grade: 9, name: 'X' };
    expect((await post(sectionsRoute.POST, undefined, body)).status).toBe(401);
    expect((await post(sectionsRoute.POST, await sid(seed.a.teacher.userId!), body)).status).toBe(403);
    expect((await post(sectionsRoute.POST, await sid(seed.a.student.userId!), body)).status).toBe(403);
    const cookie = await sid(seed.a.schoolAdmin.userId!);
    expect((await post(sectionsRoute.POST, cookie, { ...body, grade: 4 })).status).toBe(400);
    expect((await post(sectionsRoute.POST, cookie, { ...body, grade: '9' })).status).toBe(400);
    expect((await post(sectionsRoute.POST, cookie, { ...body, name: '' })).status).toBe(400);
    expect((await post(sectionsRoute.POST, cookie, 'not json', true)).status).toBe(400);
    expect((await post(sectionsRoute.POST, cookie, { ...body, grade: 8, name: '8-A' })).status).toBe(400); // duplicate of the seed
    expect((await post(sectionsRoute.POST, cookie, { ...body, branchId: 'nope' })).status).toBe(404);
    expect((await post(sectionsRoute.POST, cookie, { ...body, branchId: UUID0 })).status).toBe(404);
  });
});

describe('POST /api/school/subjects', () => {
  it('school_admin creates a subject for their own school (schoolId comes from the session)', async () => {
    const res = await post(subjectsRoute.POST, await sid(seed.a.schoolAdmin.userId!), { name: 'Physics', schoolId: seed.b.schoolId });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [row] = await withPlatform((tx) => tx.select().from(subjects).where(eq(subjects.id, id)));
    expect(row).toMatchObject({ schoolId: seed.a.schoolId, name: 'Physics' });
  });
  it('branch_admin and teacher get 403; duplicate 400; anonymous 401', async () => {
    expect((await post(subjectsRoute.POST, await sid(seed.a.branchAdmin.userId!), { name: 'Physics' })).status).toBe(403);
    expect((await post(subjectsRoute.POST, await sid(seed.a.teacher.userId!), { name: 'Physics' })).status).toBe(403);
    expect((await post(subjectsRoute.POST, undefined, { name: 'Physics' })).status).toBe(401);
    const cookie = await sid(seed.a.schoolAdmin.userId!);
    expect((await post(subjectsRoute.POST, cookie, { name: 'Mathematics' })).status).toBe(400);
    expect((await post(subjectsRoute.POST, cookie, { name: '' })).status).toBe(400);
  });
});

describe('POST /api/school/teachers', () => {
  const teacher = { username: 'New_Teacher', password: 'a-good-password-1', name: 'New Teacher' };
  it('school_admin creates a teacher; the password is set, never echoed, and the teacher can log in', async () => {
    const res = await post(teachersRoute.POST, await sid(seed.a.schoolAdmin.userId!), { ...teacher, branchId: seed.a.branchId });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(teacher.password);
    const { userId, username } = JSON.parse(text);
    expect(username).toBe('new_teacher');
    const { actor } = await login('new_teacher', teacher.password);
    expect(actor).toMatchObject({ userId, schoolId: seed.a.schoolId, branchId: seed.a.branchId, roles: ['teacher'] });
  });
  it('branch_admin only in their branch; other branch is 404/403 and creates no user', async () => {
    const cookie = await sid(seed.a.branchAdmin.userId!);
    expect((await post(teachersRoute.POST, cookie, { ...teacher, branchId: seed.a.branchId })).status).toBe(201);
    const before = (await withPlatform((tx) => tx.select().from(users))).length;
    const other = await post(teachersRoute.POST, cookie, { ...teacher, username: 'other_t', branchId: seed.b.branchId });
    expect([403, 404]).toContain(other.status);
    expect((await withPlatform((tx) => tx.select().from(users))).length).toBe(before);
  });
  it('weak password 400 WEAK_PASSWORD (not echoed), taken username 409, bad branch 404, student/teacher 403, anonymous 401', async () => {
    const cookie = await sid(seed.a.schoolAdmin.userId!);
    const weak = await post(teachersRoute.POST, cookie, { ...teacher, password: 'short', branchId: seed.a.branchId });
    expect(weak.status).toBe(400);
    expect(await errCode(weak)).toBe('WEAK_PASSWORD');
    expect((await post(teachersRoute.POST, cookie, { ...teacher, branchId: seed.a.branchId })).status).toBe(201);
    expect((await post(teachersRoute.POST, cookie, { ...teacher, branchId: seed.a.branchId })).status).toBe(409);
    expect((await post(teachersRoute.POST, cookie, { ...teacher, username: 'zz_t', branchId: 'nope' })).status).toBe(404);
    expect((await post(teachersRoute.POST, cookie, { ...teacher, username: 'zz_t', branchId: UUID0 })).status).toBe(400); // unknown branch: same answer as another school's
    expect((await post(teachersRoute.POST, cookie, { ...teacher, username: 'zz_t' })).status).toBe(400);
    expect((await post(teachersRoute.POST, await sid(seed.a.teacher.userId!), { ...teacher, branchId: seed.a.branchId })).status).toBe(403);
    expect((await post(teachersRoute.POST, undefined, { ...teacher, branchId: seed.a.branchId })).status).toBe(401);
  });
});

describe('POST /api/school/assignments', () => {
  async function newTeacher(branchId = seed.a.branchId) {
    const res = await post(teachersRoute.POST, await sid(seed.a.schoolAdmin.userId!), {
      username: 'asg_teacher', password: 'a-good-password-1', name: 'Asg', branchId,
    });
    return (await res.json()).userId as string;
  }
  it('assigns a teacher to section+subject; repeating is idempotent', async () => {
    const teacherId = await newTeacher();
    const cookie = await sid(seed.a.schoolAdmin.userId!);
    const body = { teacherId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId };
    expect((await post(assignmentsRoute.POST, cookie, body)).status).toBe(201);
    expect((await post(assignmentsRoute.POST, cookie, body)).status).toBe(201);
    expect(await withPlatform((tx) => tx.select().from(teacherAssignments).where(eq(teacherAssignments.teacherId, teacherId)))).toHaveLength(1);
  });
  it('branch_admin can assign in their branch; teacher 403; anonymous 401; malformed ids 404; wrong-branch teacher 400', async () => {
    const teacherId = await newTeacher();
    const body = { teacherId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId };
    expect((await post(assignmentsRoute.POST, await sid(seed.a.branchAdmin.userId!), body)).status).toBe(201);
    expect((await post(assignmentsRoute.POST, await sid(seed.a.teacher.userId!), body)).status).toBe(403);
    expect((await post(assignmentsRoute.POST, undefined, body)).status).toBe(401);
    const cookie = await sid(seed.a.schoolAdmin.userId!);
    for (const k of ['teacherId', 'sectionId', 'subjectId'] as const) {
      expect((await post(assignmentsRoute.POST, cookie, { ...body, [k]: 'nope' })).status).toBe(404);
    }
    expect((await post(assignmentsRoute.POST, cookie, { ...body, sectionId: UUID0 })).status).toBe(404);
    expect((await post(assignmentsRoute.POST, cookie, { ...body, subjectId: UUID0 })).status).toBe(400);
    expect((await post(assignmentsRoute.POST, cookie, { ...body, teacherId: UUID0 })).status).toBe(400);
    expect((await post(assignmentsRoute.POST, cookie, { sectionId: seed.a.sectionId })).status).toBe(400);
  });
});
