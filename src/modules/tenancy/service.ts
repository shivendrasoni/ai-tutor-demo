import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant, type Tx } from '@/db/client';
import { branches, memberships, schools, sections, subjects, teacherAssignments, users } from '@/db/schema';
import { isUniqueViolation } from '@/db/pgerror';
import { DomainError } from '@/lib/errors';
import { isUuid } from '@/lib/uuid';
import type { Actor, Role } from './actor';
import { assertUsernameFree, validateCredentials, withUsernameTakenHandling } from './auth/credentials';
import { hashPassword } from './auth/passwords';
import { assert, canManageBranch, canManageSchool, requirePlatform, runAs } from './authz';
import { generateBranchCode, normalizeBranchCode } from './codes';

export type StaffRole = Exclude<Role, 'student'>;
export type BranchByCode = { schoolId: string; branchId: string; schoolName: string; branchName: string; enabled: boolean };
export type TeacherListing = { userId: string; name: string; username: string; branchId: string; branchName: string };

const STAFF_ROLES: readonly string[] = ['school_admin', 'branch_admin', 'teacher'];
const CODE_ATTEMPTS = 5;
const MAX_NAME = 200;

const isSchoolStaff = (a: Actor) => a.isPlatformAdmin || a.roles.includes('school_admin') || a.roles.includes('branch_admin');
const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`);

/** Trims a required name; empty or over-long is VALIDATION. */
function cleanName(raw: unknown, what: string): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v === '' || v.length > MAX_NAME) throw new DomainError('VALIDATION', `${what} must be 1-${MAX_NAME} characters`);
  return v;
}

export function assertGrade(grade: number): void {
  if (!Number.isInteger(grade) || grade < 5 || grade > 12) {
    throw new DomainError('VALIDATION', 'Grade must be a whole number from 5 to 12');
  }
}

/** The school must exist (visible to the caller's scope); platform admins may name any school. */
async function assertSchoolExists(tx: Tx, schoolId: string): Promise<void> {
  if (!isUuid(schoolId)) throw notFound('School');
  const [s] = await tx.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!s) throw notFound('School');
}

export async function createSchool(actor: Actor, input: { name: string; board: string }): Promise<{ id: string }> {
  requirePlatform(actor);
  const name = cleanName(input.name, 'School name');
  const board = cleanName(input.board, 'Board');
  const [row] = await withPlatform((tx) => tx.insert(schools).values({ name, board }).returning({ id: schools.id }));
  return { id: row.id };
}

export async function createBranch(
  actor: Actor,
  input: { schoolId: string; name: string },
): Promise<{ id: string; signupCode: string }> {
  assert(canManageSchool(actor, input.schoolId));
  const name = cleanName(input.name, 'Branch name');
  let lastError: unknown;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const signupCode = generateBranchCode();
    try {
      const id = await runAs(actor, async (tx) => {
        await assertSchoolExists(tx, input.schoolId);
        const [row] = await tx
          .insert(branches)
          .values({ schoolId: input.schoolId, name, signupCode })
          .returning({ id: branches.id });
        return row.id;
      });
      return { id, signupCode };
    } catch (err) {
      if (!isUniqueViolation(err, 'branches_signup_code_unique')) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** Loads a branch through the actor's scope (RLS hides other schools' branches) and checks they can manage it. */
async function loadManagedBranch(tx: Tx, actor: Actor, branchId: string) {
  if (!isUuid(branchId)) throw notFound('Branch');
  const [b] = await tx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!b) throw notFound('Branch');
  assert(canManageBranch(actor, b.schoolId, b.id));
  return b;
}

/** Replaces the branch code with a fresh one (the old code stops working); returns the new code. */
export async function rotateBranchCode(actor: Actor, branchId: string): Promise<string> {
  assert(isSchoolStaff(actor));
  let lastError: unknown;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const signupCode = generateBranchCode();
    try {
      await runAs(actor, async (tx) => {
        const b = await loadManagedBranch(tx, actor, branchId);
        await tx.update(branches).set({ signupCode }).where(eq(branches.id, b.id));
      });
      return signupCode;
    } catch (err) {
      if (!isUniqueViolation(err, 'branches_signup_code_unique')) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export async function setBranchCodeEnabled(actor: Actor, branchId: string, enabled: boolean): Promise<void> {
  assert(isSchoolStaff(actor));
  await runAs(actor, async (tx) => {
    const b = await loadManagedBranch(tx, actor, branchId);
    await tx.update(branches).set({ signupCodeEnabled: enabled }).where(eq(branches.id, b.id));
  });
}

/** System lookup for the public join flow: no actor, so it reads on the platform connection. */
export async function findBranchByCode(code: string): Promise<BranchByCode | null> {
  const normalized = normalizeBranchCode(code);
  if (normalized === '') return null;
  const [row] = await withPlatform((tx) =>
    tx
      .select({
        schoolId: branches.schoolId,
        branchId: branches.id,
        schoolName: schools.name,
        branchName: branches.name,
        enabled: branches.signupCodeEnabled,
      })
      .from(branches)
      .innerJoin(schools, eq(schools.id, branches.schoolId))
      .where(eq(branches.signupCode, normalized))
      .limit(1),
  );
  return row ?? null;
}

export async function createSection(
  actor: Actor,
  input: { branchId: string; grade: number; name: string },
): Promise<{ id: string }> {
  assert(isSchoolStaff(actor));
  assertGrade(input.grade);
  const name = cleanName(input.name, 'Section name');
  try {
    return await runAs(actor, async (tx) => {
      const b = await loadManagedBranch(tx, actor, input.branchId);
      const [row] = await tx
        .insert(sections)
        .values({ schoolId: b.schoolId, branchId: b.id, grade: input.grade, name })
        .returning({ id: sections.id });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'sections_branch_grade_name_unique')) {
      throw new DomainError('VALIDATION', 'A section with this grade and name already exists in the branch');
    }
    throw err;
  }
}

export async function createSubject(actor: Actor, input: { schoolId: string; name: string }): Promise<{ id: string }> {
  assert(canManageSchool(actor, input.schoolId));
  const name = cleanName(input.name, 'Subject name');
  try {
    return await runAs(actor, async (tx) => {
      await assertSchoolExists(tx, input.schoolId);
      const [row] = await tx.insert(subjects).values({ schoolId: input.schoolId, name }).returning({ id: subjects.id });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'subjects_school_name_unique')) {
      throw new DomainError('VALIDATION', 'A subject with this name already exists');
    }
    throw err;
  }
}

/**
 * Creates a staff user and its membership. Authorization: a platform admin, or a school_admin of the school;
 * a branch_admin may create a teacher in their own branch only. The password is hashed and never returned.
 */
export async function createStaffUser(
  actor: Actor,
  input: {
    schoolId: string;
    branchId: string | null;
    role: StaffRole;
    username: string;
    password: string;
    name: string;
    email?: string;
  },
): Promise<{ userId: string }> {
  if (!STAFF_ROLES.includes(input.role)) throw new DomainError('VALIDATION', 'Role must be school_admin, branch_admin or teacher');
  if (input.role === 'school_admin' ? input.branchId !== null : input.branchId === null) {
    throw new DomainError(
      'VALIDATION',
      input.role === 'school_admin' ? 'A school admin has no branch' : 'This role needs a branch',
    );
  }
  const allowed =
    canManageSchool(actor, input.schoolId) ||
    (input.role === 'teacher' && input.branchId !== null && canManageBranch(actor, input.schoolId, input.branchId));
  assert(allowed);
  const username = validateCredentials(input.username, input.password);
  const name = cleanName(input.name, 'Name');
  const emailRaw = input.email?.trim() || undefined;
  if (emailRaw !== undefined && !z.email().max(254).safeParse(emailRaw).success) {
    throw new DomainError('VALIDATION', 'Invalid email');
  }
  const email = emailRaw ?? null;
  if (!isUuid(input.schoolId)) throw notFound('School');
  const passwordHash = await hashPassword(input.password);

  // Runs under the school's RLS context (defence in depth): app_user may insert into the global users table,
  // and the membership insert is checked by the tenant policy, so one atomic transaction is enough.
  const userId = await withUsernameTakenHandling(username, () =>
    withTenant(input.schoolId, async (tx) => {
      await assertSchoolExists(tx, input.schoolId);
      if (input.branchId !== null) {
        const [b] = isUuid(input.branchId)
          ? await tx
              .select({ id: branches.id })
              .from(branches)
              .where(and(eq(branches.id, input.branchId), eq(branches.schoolId, input.schoolId)))
              .limit(1)
          : [];
        if (!b) throw notFound('Branch');
      }
      await assertUsernameFree(tx, username);
      const [u] = await tx.insert(users).values({ username, passwordHash, name, email }).returning({ id: users.id });
      await tx
        .insert(memberships)
        .values({ userId: u.id, schoolId: input.schoolId, branchId: input.branchId, role: input.role });
      return u.id;
    }),
  );
  return { userId };
}

/** Idempotent. The teacher must belong to the section's branch; the subject to the section's school. */
export async function assignTeacher(
  actor: Actor,
  input: { teacherId: string; sectionId: string; subjectId: string },
): Promise<void> {
  assert(isSchoolStaff(actor));
  if (!isUuid(input.sectionId)) throw notFound('Section');
  if (!isUuid(input.teacherId)) throw notFound('Teacher');
  if (!isUuid(input.subjectId)) throw notFound('Subject');
  await runAs(actor, async (tx) => {
    const [section] = await tx.select().from(sections).where(eq(sections.id, input.sectionId)).limit(1);
    if (!section) throw notFound('Section');
    assert(canManageBranch(actor, section.schoolId, section.branchId));
    const [teacher] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, input.teacherId),
          eq(memberships.schoolId, section.schoolId),
          eq(memberships.branchId, section.branchId),
          eq(memberships.role, 'teacher'),
        ),
      )
      .limit(1);
    if (!teacher) throw notFound('Teacher');
    const [subject] = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.schoolId, section.schoolId)))
      .limit(1);
    if (!subject) throw notFound('Subject');
    await tx
      .insert(teacherAssignments)
      .values({
        schoolId: section.schoolId,
        teacherId: input.teacherId,
        sectionId: section.id,
        subjectId: input.subjectId,
      })
      .onConflictDoNothing();
  });
}

/** Public join flow: the sections of one branch, read under the school's tenant context. */
export async function listSectionsForBranch(
  schoolId: string,
  branchId: string,
): Promise<{ id: string; grade: number; name: string }[]> {
  if (!isUuid(schoolId) || !isUuid(branchId)) return [];
  return withTenant(schoolId, (tx) =>
    tx
      .select({ id: sections.id, grade: sections.grade, name: sections.name })
      .from(sections)
      .where(eq(sections.branchId, branchId))
      .orderBy(asc(sections.grade), asc(sections.name), asc(sections.id)),
  );
}

/**
 * Subjects visible to the actor: their own school for staff and teachers (RLS), every school for a platform
 * admin unless `schoolId` narrows it. Students are FORBIDDEN.
 */
export async function listSubjects(actor: Actor, schoolId?: string): Promise<{ id: string; name: string }[]> {
  assert(actor.isPlatformAdmin || actor.roles.some((r) => r !== 'student'));
  if (schoolId !== undefined && !isUuid(schoolId)) throw notFound('School');
  return runAs(actor, (tx) => {
    const q = tx.select({ id: subjects.id, name: subjects.name }).from(subjects);
    const filtered = actor.isPlatformAdmin && schoolId ? q.where(eq(subjects.schoolId, schoolId)) : q;
    return filtered.orderBy(asc(subjects.name), asc(subjects.id));
  });
}

/**
 * Teachers of a school without credentials. school_admin: whole school; branch_admin: own branch only;
 * a platform admin must name the school. Everyone else is FORBIDDEN.
 */
export async function listTeachers(actor: Actor, schoolId?: string): Promise<TeacherListing[]> {
  assert(isSchoolStaff(actor));
  let scope: string;
  if (actor.isPlatformAdmin) {
    if (!schoolId) throw new DomainError('VALIDATION', 'schoolId is required');
    if (!isUuid(schoolId)) throw notFound('School');
    scope = schoolId;
  } else {
    assert(actor.schoolId !== null);
    scope = actor.schoolId;
    // fail closed: a branch_admin without a branch must never fall back to the whole school
    if (!actor.roles.includes('school_admin')) assert(actor.branchId !== null);
  }
  const ownBranchOnly = !actor.isPlatformAdmin && !actor.roles.includes('school_admin');
  return runAs(actor, (tx) =>
    tx
      .select({
        userId: users.id,
        name: users.name,
        username: users.username,
        branchId: branches.id,
        branchName: branches.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(branches, eq(branches.id, memberships.branchId))
      .where(
        and(
          eq(memberships.schoolId, scope),
          eq(memberships.role, 'teacher'),
          ownBranchOnly && actor.branchId ? eq(memberships.branchId, actor.branchId) : undefined,
        ),
      )
      .orderBy(asc(branches.name), asc(users.name), asc(users.id)) as Promise<TeacherListing[]>,
  );
}
