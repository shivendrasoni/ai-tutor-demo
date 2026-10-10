import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { branches, sections, studentProfiles } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy/authz';

export type EnrollmentRow = {
  branchId: string;
  branchName: string;
  grade: number;
  pending: number;
  active: number;
  lapsed: number;
  removed: number;
};

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

export async function enrollmentSummary(actor: Actor, args: { schoolId?: string }): Promise<EnrollmentRow[]> {
  const requested = args?.schoolId;
  let branchId: string | null = null;
  if (actor.isPlatformAdmin) {
    if (!isUuid(requested)) throw new DomainError('VALIDATION', 'schoolId is required', { field: 'schoolId' });
  } else {
    const isSchoolAdmin = actor.roles.includes('school_admin');
    const isBranchAdmin = actor.roles.includes('branch_admin');
    if (!actor.schoolId || (!isSchoolAdmin && !isBranchAdmin)) throw new DomainError('FORBIDDEN');
    if (requested !== undefined) {
      if (!isSchoolAdmin || requested !== actor.schoolId) throw new DomainError('FORBIDDEN');
    }
    if (!isSchoolAdmin) {
      if (!actor.branchId) throw new DomainError('FORBIDDEN');
      branchId = actor.branchId;
    }
  }
  const schoolId = actor.isPlatformAdmin ? (requested as string) : (actor.schoolId as string);

  const count = (status: string) =>
    sql<number>`(count(*) filter (where ${studentProfiles.status} = ${status}))::int`;
  return runAs(actor, (tx) =>
    tx
      .select({
        branchId: studentProfiles.branchId,
        branchName: branches.name,
        grade: studentProfiles.grade,
        pending: count('pending_payment'),
        active: count('active'),
        lapsed: count('lapsed'),
        removed: count('removed'),
      })
      .from(studentProfiles)
      .innerJoin(branches, eq(branches.id, studentProfiles.branchId))
      .where(
        branchId
          ? sql`${studentProfiles.schoolId} = ${schoolId} and ${studentProfiles.branchId} = ${branchId}`
          : sql`${studentProfiles.schoolId} = ${schoolId}`,
      )
      .groupBy(studentProfiles.branchId, branches.name, studentProfiles.grade)
      .orderBy(asc(branches.name), asc(studentProfiles.grade)),
  );
}

export type BranchListing = {
  branchId: string;
  name: string;
  signupCode: string;
  signupCodeEnabled: boolean;
  sections: { id: string; grade: number; name: string }[];
};

export async function listBranches(actor: Actor): Promise<BranchListing[]> {
  const isSchoolAdmin = actor.roles.includes('school_admin');
  const isBranchAdmin = actor.roles.includes('branch_admin');
  if (actor.isPlatformAdmin || !actor.schoolId || (!isSchoolAdmin && !isBranchAdmin)) throw new DomainError('FORBIDDEN');
  const onlyBranch = isSchoolAdmin ? null : actor.branchId;
  if (!isSchoolAdmin && !onlyBranch) throw new DomainError('FORBIDDEN');

  return runAs(actor, async (tx) => {
    const bRows = await tx
      .select({
        branchId: branches.id, name: branches.name, signupCode: branches.signupCode,
        signupCodeEnabled: branches.signupCodeEnabled,
      })
      .from(branches)
      .where(onlyBranch ? sql`${branches.id} = ${onlyBranch}` : undefined)
      .orderBy(asc(branches.name), asc(branches.id));
    if (!bRows.length) return [];
    const sRows = await tx
      .select({ id: sections.id, branchId: sections.branchId, grade: sections.grade, name: sections.name })
      .from(sections)
      .orderBy(asc(sections.grade), asc(sections.name));
    return bRows.map((b) => ({
      ...b,
      sections: sRows.filter((s) => s.branchId === b.branchId).map(({ id, grade, name }) => ({ id, grade, name })),
    }));
  });
}
