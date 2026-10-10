import { DomainError } from '@/lib/errors';
import { enrollmentSummary, listBranches } from '@/modules/analytics';
import { listStudents } from '@/modules/enrollment';
import { listSubjects, listTeachers, type Actor, type StudentStatus } from '@/modules/tenancy';

export const STUDENT_STATUSES: StudentStatus[] = ['pending_payment', 'active', 'lapsed', 'removed'];

export type SchoolQuery = { branchId?: string; grade?: string; status?: string };
export type Totals = { pending: number; active: number; lapsed: number; removed: number };

function parseGrade(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 5 || n > 12) throw new DomainError('VALIDATION', 'Grade must be a whole number from 5 to 12');
  return n;
}

function parseStatus(raw: string | undefined): StudentStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(STUDENT_STATUSES as string[]).includes(raw)) throw new DomainError('VALIDATION', 'Unknown status');
  return raw as StudentStatus;
}

/** Composes the services; scope enforcement (a branch_admin's branch) stays in them and is never widened here. */
export async function loadSchoolDashboard(actor: Actor, q: SchoolQuery) {
  const grade = parseGrade(q.grade);
  const status = parseStatus(q.status);
  const branchId = q.branchId || undefined;
  const [allSummary, students, branches] = await Promise.all([
    enrollmentSummary(actor, {}),
    listStudents(actor, { branchId, grade, status }),
    listBranches(actor),
  ]);
  // enrollmentSummary is school-wide for a school_admin; narrow to the requested branch like /api/school/enrollment.
  const summary = branchId ? allSummary.filter((r) => r.branchId === branchId) : allSummary;
  const totals = summary.reduce<Totals>(
    (t, r) => ({
      pending: t.pending + r.pending, active: t.active + r.active, lapsed: t.lapsed + r.lapsed, removed: t.removed + r.removed,
    }),
    { pending: 0, active: 0, lapsed: 0, removed: 0 },
  );
  return { summary, students, branches, totals, canFilterBranch: actor.roles.includes('school_admin') };
}

/** Data for the Setup forms. Scope (a branch_admin's branch) comes from the services; subjects are managed by school_admin only. */
export async function loadSchoolSetup(actor: Actor) {
  const [branches, subjects, teachers] = await Promise.all([listBranches(actor), listSubjects(actor), listTeachers(actor)]);
  return { branches, subjects, teachers, canManageSubjects: actor.roles.includes('school_admin') };
}
