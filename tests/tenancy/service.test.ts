import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { branches, memberships, teacherAssignments, users } from '@/db/schema';
import { currentCode, resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import {
  assignTeacher, createBranch, createSchool, createSection, createStaffUser, createSubject,
  findBranchByCode, generateBranchCode, listSectionsForBranch, listTeachers, login, rotateBranchCode, setBranchCodeEnabled,
} from '@/modules/tenancy';

const PW = 'staff-password';
let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

describe('branch codes', () => {
  it('branch code is 8 chars from the unambiguous alphabet', () =>
    expect(generateBranchCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/));

  it('generates varied codes', () => {
    const codes = new Set(Array.from({ length: 50 }, generateBranchCode));
    expect(codes.size).toBeGreaterThan(45);
  });

  it('findBranchByCode trims and upper-cases; unknown is null', async () => {
    const { id, signupCode } = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'North' });
    expect(await findBranchByCode(`  ${signupCode.toLowerCase()} `)).toEqual({
      schoolId: seed.a.schoolId, branchId: id, schoolName: 'School A', branchName: 'North', enabled: true,
    });
    expect(await findBranchByCode('ZZZZZZZZ')).toBeNull();
  });

  it('rotateBranchCode replaces the code; setBranchCodeEnabled toggles', async () => {
    const old = await currentCode(seed.a.branchId);
    const fresh = await rotateBranchCode(seed.a.branchAdmin, seed.a.branchId);
    expect(fresh).not.toBe(old);
    expect(await currentCode(seed.a.branchId)).toBe(fresh);
    expect(await findBranchByCode(old)).toBeNull();
    await setBranchCodeEnabled(seed.a.schoolAdmin, seed.a.branchId, false);
    expect((await findBranchByCode(fresh))?.enabled).toBe(false);
    await setBranchCodeEnabled(seed.a.branchAdmin, seed.a.branchId, true);
    expect((await findBranchByCode(fresh))?.enabled).toBe(true);
  });

  it('teachers and other schools cannot rotate or toggle a branch code', async () => {
    await expect(rotateBranchCode(seed.a.teacher, seed.a.branchId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(rotateBranchCode(seed.b.schoolAdmin, seed.a.branchId)).rejects.toMatchObject({
      code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/),
    });
    await expect(setBranchCodeEnabled(seed.b.branchAdmin, seed.a.branchId, false)).rejects.toMatchObject({
      code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/),
    });
    await expect(rotateBranchCode(seed.a.schoolAdmin, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(rotateBranchCode(seed.a.schoolAdmin, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await currentCode(seed.a.branchId)).toBe(seed.a.code);
  });
});

describe('schools, branches, sections, subjects', () => {
  it('createSchool is platform only', async () => {
    await expect(createSchool(seed.a.schoolAdmin, { name: 'X', board: 'CBSE' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { id } = await createSchool(seed.platform, { name: 'New School', board: 'ICSE' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('branch_admin cannot create a branch; school_admin can', async () => {
    await expect(createBranch(seed.a.branchAdmin, { schoolId: seed.a.schoolId, name: 'South' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(createBranch(seed.b.schoolAdmin, { schoolId: seed.a.schoolId, name: 'South' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const r = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'South' });
    expect(r.signupCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const [row] = await withPlatform((tx) => tx.select().from(branches).where(eq(branches.id, r.id)));
    expect(row).toMatchObject({ schoolId: seed.a.schoolId, name: 'South', signupCode: r.signupCode, signupCodeEnabled: true });
  });

  it('platform admin can create a branch for any school', async () => {
    const r = await createBranch(seed.platform, { schoolId: seed.b.schoolId, name: 'East' });
    expect((await findBranchByCode(r.signupCode))?.schoolId).toBe(seed.b.schoolId);
  });

  it('createSection rejects grade 4 and 13 with VALIDATION', async () => {
    for (const grade of [4, 13, 7.5]) {
      await expect(
        createSection(seed.a.schoolAdmin, { branchId: seed.a.branchId, grade, name: 'X' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('createSection: branch admin of own branch ok, other school rejected, duplicate VALIDATION', async () => {
    const { id } = await createSection(seed.a.branchAdmin, { branchId: seed.a.branchId, grade: 9, name: '9-A' });
    expect(await listSectionsForBranch(seed.a.schoolId, seed.a.branchId)).toEqual(
      expect.arrayContaining([{ id, grade: 9, name: '9-A' }, { id: seed.a.sectionId, grade: 8, name: '8-A' }]),
    );
    await expect(
      createSection(seed.a.branchAdmin, { branchId: seed.a.branchId, grade: 9, name: '9-A' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createSection(seed.b.schoolAdmin, { branchId: seed.a.branchId, grade: 9, name: '9-B' }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) });
    await expect(
      createSection(seed.a.teacher, { branchId: seed.a.branchId, grade: 9, name: '9-B' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('listSectionsForBranch only sees its own school', async () => {
    expect(await listSectionsForBranch(seed.b.schoolId, seed.a.branchId)).toEqual([]);
  });

  it('createSubject requires canManageSchool', async () => {
    await expect(createSubject(seed.a.branchAdmin, { schoolId: seed.a.schoolId, name: 'Physics' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const { id } = await createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Physics' });
    expect(id).toBeTruthy();
    await expect(createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Physics' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('createStaffUser', () => {
  const base = { password: PW, name: 'Staff' };

  it('branch_admin can create teacher in own branch, not branch_admin', async () => {
    const { userId } = await createStaffUser(seed.a.branchAdmin, {
      ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher', username: ' New.Teacher ',
    });
    const { actor } = await login('new.teacher', PW);
    expect(actor).toMatchObject({ userId, schoolId: seed.a.schoolId, branchId: seed.a.branchId, roles: ['teacher'] });

    await expect(
      createStaffUser(seed.a.branchAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'branch_admin', username: 'ba.two',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createStaffUser(seed.a.branchAdmin, {
        ...base, schoolId: seed.b.schoolId, branchId: seed.b.branchId, role: 'teacher', username: 'other.teacher',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('school_admin creates admins; branchId rules enforced', async () => {
    await createStaffUser(seed.a.schoolAdmin, {
      ...base, schoolId: seed.a.schoolId, branchId: null, role: 'school_admin', username: 'admin.two',
    });
    await createStaffUser(seed.a.schoolAdmin, {
      ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'branch_admin', username: 'ba.two',
    });
    expect((await login('ba.two', PW)).actor.roles).toEqual(['branch_admin']);
    await expect(
      createStaffUser(seed.a.schoolAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'school_admin', username: 'admin.three',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createStaffUser(seed.a.schoolAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: null, role: 'teacher', username: 'teacher.three',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // a branch from another school
    await expect(
      createStaffUser(seed.a.schoolAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: seed.b.branchId, role: 'teacher', username: 'teacher.four',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // student role is not a staff role
    await expect(
      createStaffUser(seed.a.schoolAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'student' as never, username: 'kid.five',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('teachers and other schools cannot create staff', async () => {
    await expect(
      createStaffUser(seed.a.teacher, {
        ...base, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher', username: 't.six',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createStaffUser(seed.b.schoolAdmin, {
        ...base, schoolId: seed.a.schoolId, branchId: null, role: 'school_admin', username: 't.seven',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform admin creates the first school admin', async () => {
    const { id: schoolId } = await createSchool(seed.platform, { name: 'Fresh', board: 'CBSE' });
    const { userId } = await createStaffUser(seed.platform, {
      ...base, schoolId, branchId: null, role: 'school_admin', username: 'fresh.admin',
    });
    const rows = await withPlatform((tx) => tx.select().from(memberships).where(eq(memberships.userId, userId)));
    expect(rows).toEqual([expect.objectContaining({ schoolId, branchId: null, role: 'school_admin' })]);
  });

  it('validates credentials and reports taken usernames with suggestions', async () => {
    const mk = (username: string, password = PW) =>
      createStaffUser(seed.a.schoolAdmin, {
        ...base, password, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher', username,
      });
    await expect(mk('ab')).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
    await expect(mk('good.name', 'short')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
    await mk('dup.teacher');
    const err = await mk('DUP.teacher').catch((e) => e);
    expect(err).toMatchObject({ code: 'USERNAME_TAKEN', details: { suggestions: ['dup.teacher1', 'dup.teacher2', 'dup.teacher3'] } });
    const count = await withPlatform((tx) => tx.select().from(users).where(eq(users.username, 'dup.teacher')));
    expect(count).toHaveLength(1);
  });
});

describe('assignTeacher', () => {
  it('assigns a teacher to a section and subject; idempotent', async () => {
    const { userId } = await createStaffUser(seed.a.schoolAdmin, {
      password: PW, name: 'T', schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher', username: 'assign.me',
    });
    const args = { teacherId: userId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId };
    await assignTeacher(seed.a.branchAdmin, args);
    await assignTeacher(seed.a.branchAdmin, args);
    const rows = await withPlatform((tx) =>
      tx.select().from(teacherAssignments).where(and(eq(teacherAssignments.teacherId, userId))),
    );
    expect(rows).toEqual([expect.objectContaining({ schoolId: seed.a.schoolId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId })]);
  });

  it('rejects cross-school ids, non-teachers, and unauthorized actors', async () => {
    const ok = { teacherId: seed.a.teacherId, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId };
    await expect(assignTeacher(seed.a.teacher, ok)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assignTeacher(seed.b.schoolAdmin, ok)).rejects.toMatchObject({
      code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/),
    });
    await expect(assignTeacher(seed.a.schoolAdmin, { ...ok, subjectId: seed.b.subjectId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(assignTeacher(seed.a.schoolAdmin, { ...ok, teacherId: seed.b.teacherId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(assignTeacher(seed.a.schoolAdmin, { ...ok, teacherId: seed.a.studentId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('fix round 1', () => {
  it('createStaffUser rejects a malformed email with VALIDATION and creates no user', async () => {
    const err = await createStaffUser(seed.a.schoolAdmin, {
      password: PW, name: 'T', schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher',
      username: 'bad.email', email: 'not-an-email',
    }).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION', message: 'Invalid email' });
    expect(await withPlatform((tx) => tx.select().from(users).where(eq(users.username, 'bad.email')))).toHaveLength(0);
  });

  it('listTeachers fails closed for a branch_admin without a branch', async () => {
    await expect(listTeachers({ ...seed.a.branchAdmin, branchId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
