/**
 * Cross-school isolation for the school-setup surface (sections, subjects, teachers, assignments).
 * School A's actors target School B's ids through the API routes and services; each call must be denied
 * (403/404, or 400 where the input is simply invalid for A), leak nothing, and leave B's data unchanged.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { tenantTables } from '@/db/schema';
import { createSession, listTeachers } from '@/modules/tenancy';
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

async function snapshot(schoolId: string) {
  return withPlatform(async (tx) => {
    const out: Record<string, unknown[]> = {};
    for (const T of tenantTables) {
      out[String(T)] = (await tx.execute(sql`select * from ${T} where school_id = ${schoolId} order by ${sql.raw('ctid')}`)).rows;
    }
    out.users = (await tx.execute(sql`select count(*)::int as n from users`)).rows;
    return out;
  });
}

async function call(handler: (r: Request) => Promise<Response>, userId: string, body: unknown) {
  const res = await handler(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { cookie: `sid=${await createSession(userId)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, text: await res.text() };
}

const teacherBody = (branchId: string) => ({ username: 'intruder_t', password: 'a-good-password-1', name: 'Intruder', branchId });

describe('setup routes: School A actors against School B ids', () => {
  for (const [label, actorOf] of [
    ['school_admin', (s: Seed) => s.a.schoolAdmin.userId!],
    ['branch_admin', (s: Seed) => s.a.branchAdmin.userId!],
  ] as const) {
    it(`${label}: section in B's branch is denied and B is unchanged`, async () => {
      const before = await snapshot(seed.b.schoolId);
      const r = await call(sectionsRoute.POST, actorOf(seed), { branchId: seed.b.branchId, grade: 9, name: 'Z-1' });
      expect([403, 404]).toContain(r.status);
      expect(await snapshot(seed.b.schoolId)).toEqual(before);
    });
    it(`${label}: teacher in B's branch is denied, creates no user`, async () => {
      const before = await snapshot(seed.b.schoolId);
      const r = await call(teachersRoute.POST, actorOf(seed), teacherBody(seed.b.branchId));
      expect([400, 403, 404]).toContain(r.status); // 400: RLS hides B's branch, indistinguishable from an unknown one
      expect(await snapshot(seed.b.schoolId)).toEqual(before);
    });
    it(`${label}: assigning B's teacher/section/subject is denied`, async () => {
      const before = await snapshot(seed.b.schoolId);
      const ids = { teacherId: seed.b.teacherId, sectionId: seed.b.sectionId, subjectId: seed.b.subjectId };
      for (const body of [
        ids,
        { ...ids, teacherId: seed.a.teacherId }, // A teacher, B section
        { ...ids, sectionId: seed.a.sectionId, teacherId: seed.a.teacherId }, // B subject on A section
        { ...ids, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId }, // B teacher on A section
      ]) {
        const r = await call(assignmentsRoute.POST, actorOf(seed), body);
        expect([400, 403, 404]).toContain(r.status);
      }
      expect(await snapshot(seed.b.schoolId)).toEqual(before);
    });
  }

  it('a subject is always created in the caller school: a body schoolId for B is ignored', async () => {
    const before = await snapshot(seed.b.schoolId);
    const r = await call(subjectsRoute.POST, seed.a.schoolAdmin.userId!, { name: 'Chemistry', schoolId: seed.b.schoolId });
    expect(r.status).toBe(201);
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
  });

  it("B's school_admin is denied on A's ids symmetrically", async () => {
    const before = await snapshot(seed.a.schoolId);
    const s = await call(sectionsRoute.POST, seed.b.schoolAdmin.userId!, { branchId: seed.a.branchId, grade: 9, name: 'Z-1' });
    expect([403, 404]).toContain(s.status);
    const t = await call(teachersRoute.POST, seed.b.schoolAdmin.userId!, teacherBody(seed.a.branchId));
    expect([400, 403, 404]).toContain(t.status);
    expect(await snapshot(seed.a.schoolId)).toEqual(before);
  });

  it('teachers and students cannot use any setup route', async () => {
    const before = await snapshot(seed.a.schoolId);
    for (const userId of [seed.a.teacher.userId!, seed.a.student.userId!]) {
      expect((await call(sectionsRoute.POST, userId, { branchId: seed.a.branchId, grade: 9, name: 'Z' })).status).toBe(403);
      expect((await call(subjectsRoute.POST, userId, { name: 'Z' })).status).toBe(403);
      expect((await call(teachersRoute.POST, userId, teacherBody(seed.a.branchId))).status).toBe(403);
      expect((await call(assignmentsRoute.POST, userId, { teacherId: seed.a.teacherId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId })).status).toBe(403);
    }
    expect(await snapshot(seed.a.schoolId)).toEqual(before);
  });

  it('error bodies never contain the other school ids or the submitted password', async () => {
    const r = await call(teachersRoute.POST, seed.a.schoolAdmin.userId!, teacherBody(seed.b.branchId));
    expect(r.text).not.toContain(seed.b.schoolId);
    expect(r.text).not.toContain('a-good-password-1');
  });
});

describe('listTeachers isolation', () => {
  it("returns only the caller's school (and a branch_admin's branch); never B teachers", async () => {
    const asAdmin = await listTeachers(seed.a.schoolAdmin);
    expect(asAdmin.map((t) => t.userId)).toEqual([seed.a.teacherId]);
    expect((await listTeachers(seed.a.branchAdmin)).map((t) => t.userId)).toEqual([seed.a.teacherId]);
    expect((await listTeachers(seed.b.schoolAdmin)).map((t) => t.userId)).toEqual([seed.b.teacherId]);
    await expect(listTeachers(seed.a.teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listTeachers(seed.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('platform admin must name a school and sees only that school', async () => {
    await expect(listTeachers(seed.platform)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await listTeachers(seed.platform, seed.b.schoolId)).map((t) => t.userId)).toEqual([seed.b.teacherId]);
  });
});
