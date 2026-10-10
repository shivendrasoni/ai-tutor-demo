import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  branches, plans, sections, studentProfiles, subscriptions, users,
} from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor, StudentStatus } from '@/modules/tenancy/actor';
import { canManageBranch, runAs } from '@/modules/tenancy/authz';
import { revokeUserSessions } from '@/modules/tenancy/auth/sessions';

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

const FilterSchema = z.object({
  schoolId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  grade: z.number().int().min(5).max(12).optional(),
  status: z.enum(['pending_payment', 'active', 'lapsed', 'removed']).optional(),
});

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

export async function listStudents(
  actor: Actor,
  filters: { schoolId?: string; branchId?: string; grade?: number; status?: StudentStatus },
): Promise<StudentRow[]> {
  const parsed = FilterSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid filters', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const f = parsed.data;

  let schoolId: string;
  let branchId = f.branchId;
  if (actor.isPlatformAdmin) {
    if (!f.schoolId) throw new DomainError('VALIDATION', 'schoolId is required', { field: 'schoolId' });
    schoolId = f.schoolId;
  } else {
    const isSchoolAdmin = actor.roles.includes('school_admin');
    const isBranchAdmin = actor.roles.includes('branch_admin');
    if (!actor.schoolId || (!isSchoolAdmin && !isBranchAdmin)) throw new DomainError('FORBIDDEN');
    if (f.schoolId && f.schoolId !== actor.schoolId) throw new DomainError('FORBIDDEN');
    schoolId = actor.schoolId;
    if (!isSchoolAdmin) {
      if (!actor.branchId) throw new DomainError('FORBIDDEN');
      if (branchId && branchId !== actor.branchId) throw new DomainError('FORBIDDEN');
      branchId = actor.branchId;
    } else if (branchId) {
      const own = await runAs(actor, (tx) =>
        tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId as string), eq(branches.schoolId, schoolId))),
      );
      if (own.length === 0) throw new DomainError('FORBIDDEN');
    }
  }

  const conds: SQL[] = [eq(studentProfiles.schoolId, schoolId)];
  if (branchId) conds.push(eq(studentProfiles.branchId, branchId));
  if (f.grade !== undefined) conds.push(eq(studentProfiles.grade, f.grade));
  if (f.status) conds.push(eq(studentProfiles.status, f.status));

  const rows = await runAs(actor, (tx) =>
    tx
      .select({
        userId: users.id,
        name: users.name,
        username: users.username,
        branchId: studentProfiles.branchId,
        branchName: branches.name,
        grade: studentProfiles.grade,
        sectionName: sections.name,
        status: studentProfiles.status,
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
      .orderBy(asc(users.name), asc(users.id)),
  );
  return rows as StudentRow[];
}

export async function removeStudent(actor: Actor, studentUserId: string): Promise<void> {
  const notFound = () => new DomainError('NOT_FOUND', 'Student not found');
  if (!isUuid(studentUserId)) throw notFound();
  await runAs(actor, async (tx) => {
    const [profile] = await tx
      .select({ schoolId: studentProfiles.schoolId, branchId: studentProfiles.branchId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, studentUserId));
    if (!profile) throw notFound();
    if (!canManageBranch(actor, profile.schoolId, profile.branchId)) throw new DomainError('FORBIDDEN');

    // Lock order must match recordPayment (subscription row first, then profile) to avoid deadlocks.
    await tx.execute(sql`select id from subscriptions where student_id = ${studentUserId} for update`);
    await tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, studentUserId));
    await tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.studentId, studentUserId));
    await revokeUserSessions(tx, studentUserId);
  });
}

export async function studentStatus(
  actor: Actor,
): Promise<{ status: StudentStatus; planName: string | null; periodEnd: Date | null }> {
  if (!actor.roles.includes('student')) throw new DomainError('FORBIDDEN', 'Students only');
  const [row] = await runAs(actor, (tx) =>
    tx
      .select({
        status: studentProfiles.status,
        planName: plans.name,
        periodEnd: subscriptions.currentPeriodEnd,
      })
      .from(studentProfiles)
      .leftJoin(subscriptions, eq(subscriptions.studentId, studentProfiles.userId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(studentProfiles.userId, actor.userId)),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Student profile not found');
  return row as { status: StudentStatus; planName: string | null; periodEnd: Date | null };
}
