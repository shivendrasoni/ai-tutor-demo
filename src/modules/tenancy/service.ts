import { and, asc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant, type Tx } from '@/db/client';
import { isUniqueViolation } from '@/db/pgerror';
import { branches, memberships, schools, sections, subjects, teacherAssignments, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor, Role } from './actor';
import { assertUsernameFree, validateCredentials, withUsernameTakenHandling } from './auth/credentials';
import { hashPassword } from './auth/passwords';
import { assert, canManageBranch, canManageSchool, requirePlatform, runAs } from './authz';
import { generateBranchCode, normalizeBranchCode } from './codes';

const CODE_RETRIES = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function requireText(value: unknown, field: string, max = 200): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > max) throw new DomainError('VALIDATION', `${field} is required (max ${max} chars)`, { field });
  return v;
}

/** Retries `fn` when it trips the branches.signup_code unique constraint (each attempt is its own tx). */
async function retryOnCodeCollision<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < CODE_RETRIES && isUniqueViolation(err, 'branches_signup_code_unique')) continue;
      throw err;
    }
  }
}

/** Loads a branch visible to the actor (RLS hides other schools) and checks canManageBranch. */
async function loadManagedBranch(tx: Tx, actor: Actor, branchId: string) {
  if (!isUuid(branchId)) throw new DomainError('NOT_FOUND', 'Branch not found');
  const [row] = await tx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'Branch not found');
  assert(canManageBranch(actor, row.schoolId, row.id));
  return row;
}

export async function createSchool(actor: Actor, input: { name: string; board: string }): Promise<{ id: string }> {
  requirePlatform(actor);
  const name = requireText(input.name, 'name');
  const board = requireText(input.board, 'board', 50);
  const [row] = await withPlatform((tx) => tx.insert(schools).values({ name, board }).returning({ id: schools.id }));
  return row;
}

export async function createBranch(
  actor: Actor,
  input: { schoolId: string; name: string },
): Promise<{ id: string; signupCode: string }> {
  if (!isUuid(input.schoolId)) throw new DomainError('FORBIDDEN');
  assert(canManageSchool(actor, input.schoolId));
  const name = requireText(input.name, 'name');
  return retryOnCodeCollision(() =>
    runAs(actor, async (tx) => {
      const [school] = await tx.select({ id: schools.id }).from(schools).where(eq(schools.id, input.schoolId));
      if (!school) throw new DomainError('NOT_FOUND', 'School not found');
      const [row] = await tx
        .insert(branches)
        .values({ schoolId: input.schoolId, name, signupCode: generateBranchCode() })
        .returning({ id: branches.id, signupCode: branches.signupCode });
      return row;
    }),
  );
}

export async function rotateBranchCode(actor: Actor, branchId: string): Promise<string> {
  return retryOnCodeCollision(() =>
    runAs(actor, async (tx) => {
      await loadManagedBranch(tx, actor, branchId);
      const signupCode = generateBranchCode();
      await tx.update(branches).set({ signupCode }).where(eq(branches.id, branchId));
      return signupCode;
    }),
  );
}

export async function setBranchCodeEnabled(actor: Actor, branchId: string, enabled: boolean): Promise<void> {
  if (typeof enabled !== 'boolean') throw new DomainError('VALIDATION', 'enabled must be boolean');
  await runAs(actor, async (tx) => {
    await loadManagedBranch(tx, actor, branchId);
    await tx.update(branches).set({ signupCodeEnabled: enabled }).where(eq(branches.id, branchId));
  });
}

export function assertGrade(grade: unknown): asserts grade is number {
  if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 5 || grade > 12) {
    throw new DomainError('VALIDATION', 'Grade must be an integer from 5 to 12', { field: 'grade' });
  }
}

export async function createSection(
  actor: Actor,
  input: { branchId: string; grade: number; name: string },
): Promise<{ id: string }> {
  assertGrade(input.grade);
  const name = requireText(input.name, 'name', 50);
  try {
    return await runAs(actor, async (tx) => {
      const branch = await loadManagedBranch(tx, actor, input.branchId);
      const [row] = await tx
        .insert(sections)
        .values({ schoolId: branch.schoolId, branchId: branch.id, grade: input.grade, name })
        .returning({ id: sections.id });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'sections_branch_grade_name_unique')) {
      throw new DomainError('VALIDATION', 'A section with this name already exists for that grade', { field: 'name' });
    }
    throw err;
  }
}

export async function createSubject(actor: Actor, input: { schoolId: string; name: string }): Promise<{ id: string }> {
  if (!isUuid(input.schoolId)) throw new DomainError('FORBIDDEN');
  assert(canManageSchool(actor, input.schoolId));
  const name = requireText(input.name, 'name', 100);
  try {
    return await runAs(actor, async (tx) => {
      const [row] = await tx.insert(subjects).values({ schoolId: input.schoolId, name }).returning({ id: subjects.id });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'subjects_school_name_unique')) {
      throw new DomainError('VALIDATION', 'Subject already exists', { field: 'name' });
    }
    throw err;
  }
}

export type StaffRole = Exclude<Role, 'student'>;
const STAFF_ROLES: readonly StaffRole[] = ['school_admin', 'branch_admin', 'teacher'];

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
  const { schoolId, branchId, role } = input;
  if (!STAFF_ROLES.includes(role)) throw new DomainError('VALIDATION', 'Invalid staff role', { field: 'role' });
  if (role === 'school_admin' && branchId !== null) {
    throw new DomainError('VALIDATION', 'A school admin must not have a branch', { field: 'branchId' });
  }
  if (role !== 'school_admin' && !isUuid(branchId)) {
    throw new DomainError('VALIDATION', 'This role requires a branch', { field: 'branchId' });
  }
  if (!isUuid(schoolId)) throw new DomainError('FORBIDDEN');
  const allowed =
    canManageSchool(actor, schoolId) ||
    (role === 'teacher' && branchId !== null && canManageBranch(actor, schoolId, branchId));
  assert(allowed);

  const name = requireText(input.name, 'name');
  let email: string | null = null;
  if (input.email !== undefined && input.email !== null && input.email.trim() !== '') {
    const parsed = z.email().safeParse(input.email.trim());
    if (!parsed.success) throw new DomainError('VALIDATION', 'Invalid email', { field: 'email' });
    email = parsed.data;
  }
  const username = validateCredentials(input.username, input.password);
  const passwordHash = await hashPassword(input.password);

  return withUsernameTakenHandling(username, () =>
    withTenant(schoolId, async (tx) => {
      if (branchId !== null) {
        // RLS scopes this to schoolId, so another school's branch is simply not found.
        const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
        if (!b) throw new DomainError('VALIDATION', 'Branch does not belong to this school', { field: 'branchId' });
      } else {
        const [s] = await tx.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId));
        if (!s) throw new DomainError('NOT_FOUND', 'School not found');
      }
      await assertUsernameFree(tx, username);
      const [u] = await tx.insert(users).values({ username, passwordHash, name, email }).returning({ id: users.id });
      await tx.insert(memberships).values({ userId: u.id, schoolId, branchId, role });
      return { userId: u.id };
    }),
  );
}

export async function assignTeacher(
  actor: Actor,
  input: { teacherId: string; sectionId: string; subjectId: string },
): Promise<void> {
  const { teacherId, sectionId, subjectId } = input;
  await runAs(actor, async (tx) => {
    if (!isUuid(sectionId)) throw new DomainError('NOT_FOUND', 'Section not found');
    const [section] = await tx.select().from(sections).where(eq(sections.id, sectionId)).limit(1);
    if (!section) throw new DomainError('NOT_FOUND', 'Section not found');
    assert(canManageBranch(actor, section.schoolId, section.branchId));

    if (!isUuid(subjectId) || !isUuid(teacherId)) throw new DomainError('VALIDATION', 'Invalid teacher or subject');
    const [subject] = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.schoolId, section.schoolId)));
    if (!subject) throw new DomainError('VALIDATION', 'Subject not in this school', { field: 'subjectId' });
    const [teacher] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, teacherId),
          eq(memberships.schoolId, section.schoolId),
          eq(memberships.branchId, section.branchId),
          eq(memberships.role, 'teacher'),
        ),
      );
    if (!teacher) throw new DomainError('VALIDATION', 'Not a teacher in this branch', { field: 'teacherId' });

    await tx
      .insert(teacherAssignments)
      .values({ schoolId: section.schoolId, teacherId, sectionId, subjectId })
      .onConflictDoNothing();
  });
}

export type BranchByCode = {
  schoolId: string;
  branchId: string;
  schoolName: string;
  branchName: string;
  enabled: boolean;
};

/** System lookup (bypasses RLS): resolves a signup code to its branch. Code is trimmed and upper-cased. */
export async function findBranchByCode(code: string): Promise<BranchByCode | null> {
  const normalized = normalizeBranchCode(typeof code === 'string' ? code : '');
  if (!normalized) return null;
  const rows = await withPlatform((tx) =>
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
  return rows[0] ?? null;
}

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
      .orderBy(asc(sections.grade), asc(sections.name)),
  );
}

/** Subjects of the actor's school. Staff only; a platform admin sees every school's subjects, or one school's with `schoolId`. */
export async function listSubjects(actor: Actor, schoolId?: string): Promise<{ id: string; name: string }[]> {
  const isStaff = actor.schoolId !== null && actor.roles.some((r) => r !== 'student');
  if (!actor.isPlatformAdmin && !isStaff) throw new DomainError('FORBIDDEN');
  const only = actor.isPlatformAdmin && schoolId !== undefined;
  if (only && !isUuid(schoolId)) return [];
  return runAs(actor, (tx) =>
    tx
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(only ? eq(subjects.schoolId, schoolId!) : undefined)
      .orderBy(asc(subjects.name)),
  );
}

export type TeacherListing = { userId: string; name: string; username: string | null; branchId: string; branchName: string };

/**
 * Teacher accounts the actor administers, ordered by name: a school_admin sees the whole school, a branch_admin
 * only their branch. A platform admin must name the school (`schoolId`); other roles are FORBIDDEN. Never returns
 * credentials.
 */
export async function listTeachers(actor: Actor, schoolId?: string): Promise<TeacherListing[]> {
  const isSchoolAdmin = actor.roles.includes('school_admin');
  const isBranchAdmin = actor.roles.includes('branch_admin');
  if (!actor.isPlatformAdmin && !isSchoolAdmin && !isBranchAdmin) throw new DomainError('FORBIDDEN');
  const filters: SQL[] = [eq(memberships.role, 'teacher')];
  if (actor.isPlatformAdmin) {
    if (!isUuid(schoolId)) throw new DomainError('VALIDATION', 'A school is required', { field: 'schoolId' });
    filters.push(eq(memberships.schoolId, schoolId));
  } else {
    if (!actor.schoolId) throw new DomainError('FORBIDDEN');
    filters.push(eq(memberships.schoolId, actor.schoolId));
    if (!isSchoolAdmin) {
      if (!actor.branchId) throw new DomainError('FORBIDDEN');
      filters.push(eq(memberships.branchId, actor.branchId));
    }
  }
  const rows = await runAs(actor, (tx) =>
    tx
      .select({
        userId: users.id, name: users.name, username: users.username,
        branchId: memberships.branchId, branchName: branches.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(branches, eq(branches.id, memberships.branchId))
      .where(and(...filters))
      .orderBy(asc(users.name), asc(users.id)),
  );
  return rows.map((r) => ({ ...r, branchId: r.branchId! }));
}
