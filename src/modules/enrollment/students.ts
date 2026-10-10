import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { branches, plans, sections, studentProfiles, subscriptions, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { isUuid } from '@/lib/uuid';
import type { Actor, StudentStatus } from '@/modules/tenancy/actor';
import { assertPasswordStrength, hashPassword } from '@/modules/tenancy/auth/passwords';
import { revokeUserSessions } from '@/modules/tenancy/auth/sessions';
import { canManageBranch, runAs } from '@/modules/tenancy/authz';
import { effectiveStatusSql, effectiveStudentStatus } from './lapse';

export type StudentRow = {
  userId: string;
  name: string;
  username: string | null;
  branchId: string;
  branchName: string;
  grade: number;
  sectionName: string | null;
  status: StudentStatus;
  planName: string | null;
  periodEnd: Date | null;
};

export type StudentFilter = { schoolId?: string; branchId?: string; grade?: number; status?: StudentStatus };

const STATUSES: StudentStatus[] = ['pending_payment', 'active', 'lapsed', 'removed'];

const validation = (message: string) => new DomainError('VALIDATION', message);

function validateFilter(filter: StudentFilter): void {
  const { schoolId, branchId, grade, status } = filter;
  if (schoolId !== undefined && !isUuid(schoolId)) throw validation('Invalid schoolId');
  if (branchId !== undefined && !isUuid(branchId)) throw validation('Invalid branchId');
  if (grade !== undefined && !(Number.isInteger(grade) && grade >= 5 && grade <= 12)) {
    throw validation('Grade must be a whole number from 5 to 12');
  }
  if (status !== undefined && !STATUSES.includes(status)) throw validation('Unknown status');
}

/** Students visible to the actor: whole school for a school_admin, own branch for a branch_admin, one school for a platform admin. */
export async function listStudents(actor: Actor, filter: StudentFilter = {}, now: Date = new Date()): Promise<StudentRow[]> {
  validateFilter(filter);
  const { grade, status } = filter;
  let schoolId: string;
  let branchId = filter.branchId;
  let checkBranchInSchool = false;

  if (actor.isPlatformAdmin) {
    if (!filter.schoolId) throw validation('schoolId is required');
    schoolId = filter.schoolId;
  } else if (actor.schoolId && actor.roles.includes('school_admin')) {
    if (filter.schoolId !== undefined && filter.schoolId !== actor.schoolId) throw new DomainError('FORBIDDEN');
    schoolId = actor.schoolId;
    checkBranchInSchool = branchId !== undefined;
  } else if (actor.schoolId && actor.branchId && actor.roles.includes('branch_admin')) {
    if (filter.schoolId !== undefined && filter.schoolId !== actor.schoolId) throw new DomainError('FORBIDDEN');
    if (branchId !== undefined && branchId !== actor.branchId) throw new DomainError('FORBIDDEN');
    schoolId = actor.schoolId;
    branchId = actor.branchId;
  } else {
    throw new DomainError('FORBIDDEN');
  }

  const effective = effectiveStatusSql(now);
  return runAs(actor, async (tx) => {
    if (checkBranchInSchool) {
      const [b] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId!), eq(branches.schoolId, schoolId)));
      if (!b) throw new DomainError('FORBIDDEN');
    }
    const conds: SQL[] = [eq(studentProfiles.schoolId, schoolId)];
    if (branchId) conds.push(eq(studentProfiles.branchId, branchId));
    if (grade !== undefined) conds.push(eq(studentProfiles.grade, grade));
    if (status) conds.push(sql`${effective} = ${status}`);

    const rows = await tx
      .select({
        userId: studentProfiles.userId,
        name: users.name,
        username: users.username,
        branchId: studentProfiles.branchId,
        branchName: branches.name,
        grade: studentProfiles.grade,
        sectionName: sections.name,
        status: effective,
        planName: plans.name,
        periodEnd: subscriptions.currentPeriodEnd,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .innerJoin(branches, eq(branches.id, studentProfiles.branchId))
      .leftJoin(sections, eq(sections.id, studentProfiles.sectionId))
      .leftJoin(subscriptions, eq(subscriptions.studentId, studentProfiles.userId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(...conds))
      .orderBy(asc(users.name), asc(studentProfiles.userId));
    return rows as StudentRow[];
  });
}

/** Marks the student removed, cancels the subscription and revokes sessions. Idempotent; data is kept. */
export async function removeStudent(actor: Actor, studentUserId: string): Promise<void> {
  const notFound = () => new DomainError('NOT_FOUND', 'Student not found');
  if (!isUuid(studentUserId)) throw notFound();
  await runAs(actor, async (tx) => {
    const [row] = await tx
      .select({ schoolId: studentProfiles.schoolId, branchId: studentProfiles.branchId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, studentUserId));
    if (!row) throw notFound();
    if (!canManageBranch(actor, row.schoolId, row.branchId)) throw new DomainError('FORBIDDEN');

    // Lock order (subscription, then profile) matches recordPayment so the two serialize.
    await tx.execute(sql`select id from subscriptions where student_id = ${studentUserId} for update`);
    await tx.execute(sql`select user_id from student_profiles where user_id = ${studentUserId} for update`);
    await tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.studentId, studentUserId));
    await tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, studentUserId));
    await revokeUserSessions(tx, studentUserId);
  });
}

/** The acting student's own status, with the read-time lapse applied. */
export async function studentStatus(
  actor: Actor,
  now: Date = new Date(),
): Promise<{ status: StudentStatus; planName: string | null; periodEnd: Date | null }> {
  if (!actor.roles.includes('student') || !actor.schoolId) throw new DomainError('FORBIDDEN');
  const status = await effectiveStudentStatus(actor.userId, now);
  if (!status) throw new DomainError('NOT_FOUND', 'Student not found');
  const [row] = await runAs(actor, (tx) =>
    tx
      .select({ planName: plans.name, periodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.studentId, actor.userId)),
  );
  return { status, planName: row?.planName ?? null, periodEnd: row?.periodEnd ?? null };
}

/** Admin-initiated password reset; revokes the student's sessions. */
export async function resetStudentPassword(actor: Actor, studentUserId: string, newPassword: string): Promise<void> {
  const notFound = () => new DomainError('NOT_FOUND', 'Student not found');
  if (!isUuid(studentUserId)) throw notFound();
  await runAs(actor, async (tx) => {
    const [row] = await tx
      .select({ schoolId: studentProfiles.schoolId, branchId: studentProfiles.branchId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, studentUserId));
    if (!row) throw notFound();
    if (!canManageBranch(actor, row.schoolId, row.branchId)) throw new DomainError('FORBIDDEN');
    assertPasswordStrength(newPassword);

    // Lock the user, then re-read state so a concurrent removal or signup is seen.
    await tx.execute(sql`select id from users where id = ${studentUserId} for update`);
    const [fresh] = await tx
      .select({ status: studentProfiles.status, username: users.username, passwordHash: users.passwordHash })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .where(eq(studentProfiles.userId, studentUserId));
    if (!fresh) throw notFound();
    if (fresh.status === 'removed') throw new DomainError('STUDENT_REMOVED', 'Student has been removed');
    if (!fresh.username || !fresh.passwordHash) {
      throw validation('This student has not signed up yet; send them an invite instead');
    }

    await tx.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, studentUserId));
    await revokeUserSessions(tx, studentUserId);
  });
}
