import type { CoreSeed, CoreUser, StudentStatus } from '../../core/seed-core';

/** Extra school-area state (the shared people/branches/sections/subjects live in the core slice). */
export type SchoolSlice = {
  /** Branch ids whose signup code is disabled. */
  codeDisabled: string[];
  /** Current invite token per not-yet-signed-up student. */
  invites: Record<string, string>;
  /** Parent details captured when an admin adds a student. */
  parents: Record<string, { name: string; phone: string; email?: string }>;
  /** Last admin-initiated password reset per student (the password itself is never stored). */
  passwordResets: Record<string, { at: string }>;
  /** Teacher -> section -> subject assignments made from the setup form. */
  assignments: { teacherId: string; sectionId: string; subjectId: string }[];
};

export const STUDENT_STATUSES: StudentStatus[] = ['pending_payment', 'active', 'lapsed', 'removed'];

export type SchoolQuery = { branchId?: string; grade?: string; status?: string };
export type Totals = { pending: number; active: number; lapsed: number; removed: number };
export type EnrollmentRow = {
  branchId: string; branchName: string; grade: number; pending: number; active: number; lapsed: number; removed: number;
};
export type StudentRow = {
  userId: string; name: string; username: string | null; branchId: string; branchName: string; grade: number;
  sectionName: string | null; status: StudentStatus; planName: string | null; periodEnd: Date | null;
};
export type BranchListing = {
  branchId: string; name: string; signupCode: string; signupCodeEnabled: boolean;
  sections: { id: string; grade: number; name: string }[];
};
export type TeacherListing = { userId: string; name: string; username: string | null; branchId: string; branchName: string };

/** Thrown by the pure loaders; `code` mirrors the real DomainError codes. */
export class SchoolError extends Error {
  constructor(readonly code: 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND', message?: string) {
    super(message ?? code);
  }
}

export const emptySchoolSlice = (): SchoolSlice => ({ codeDisabled: [], invites: {}, parents: {}, passwordResets: {}, assignments: [] });

const isSchoolAdmin = (u: CoreUser | null) => u?.role === 'school_admin';

/** Branch ids the actor can see: everything for a school admin, only their own for a branch admin. */
function scopeBranches(core: CoreSeed, actor: CoreUser | null) {
  if (!actor || (actor.role !== 'school_admin' && actor.role !== 'branch_admin')) throw new SchoolError('FORBIDDEN');
  return isSchoolAdmin(actor) ? core.branches : core.branches.filter((b) => b.id === actor.branchId);
}

function parseGrade(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 5 || n > 12) throw new SchoolError('VALIDATION', 'Grade must be a whole number from 5 to 12');
  return n;
}

function parseStatus(raw: string | undefined): StudentStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(STUDENT_STATUSES as string[]).includes(raw)) throw new SchoolError('VALIDATION', 'Unknown status');
  return raw as StudentStatus;
}

export function listBranchesFor(core: CoreSeed, school: SchoolSlice, actor: CoreUser | null): BranchListing[] {
  return [...scopeBranches(core, actor)]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((b) => ({
      branchId: b.id,
      name: b.name,
      signupCode: b.code,
      signupCodeEnabled: !school.codeDisabled.includes(b.id),
      sections: core.sections
        .filter((s) => s.branchId === b.id)
        .sort((a, c) => a.grade - c.grade || a.name.localeCompare(c.name))
        .map(({ id, grade, name }) => ({ id, grade, name })),
    }));
}

export function enrollmentSummaryFor(core: CoreSeed, actor: CoreUser | null): EnrollmentRow[] {
  const visible = new Set(scopeBranches(core, actor).map((b) => b.id));
  const rows = new Map<string, EnrollmentRow>();
  for (const u of core.users) {
    if (u.role !== 'student' || !u.branchId || !visible.has(u.branchId) || u.grade === undefined) continue;
    const key = `${u.branchId}:${u.grade}`;
    let r = rows.get(key);
    if (!r) {
      r = { branchId: u.branchId, branchName: core.branches.find((b) => b.id === u.branchId)!.name, grade: u.grade, pending: 0, active: 0, lapsed: 0, removed: 0 };
      rows.set(key, r);
    }
    const s = u.status ?? 'active';
    if (s === 'pending_payment') r.pending++;
    else r[s]++;
  }
  return [...rows.values()].sort((a, b) => a.branchName.localeCompare(b.branchName) || a.grade - b.grade);
}

export function listStudentsFor(
  core: CoreSeed, school: SchoolSlice, actor: CoreUser | null,
  f: { branchId?: string; grade?: number; status?: StudentStatus },
): StudentRow[] {
  const visible = new Set(scopeBranches(core, actor).map((b) => b.id));
  if (f.branchId !== undefined && !visible.has(f.branchId)) throw new SchoolError('FORBIDDEN');
  return core.users
    .filter((u) => u.role === 'student' && u.branchId && visible.has(u.branchId))
    .filter((u) => (f.branchId ? u.branchId === f.branchId : true) && (f.grade ? u.grade === f.grade : true) && (f.status ? u.status === f.status : true))
    .map((u): StudentRow => {
      const status = u.status ?? 'active';
      const paying = status === 'active' || status === 'lapsed';
      return {
        userId: u.id,
        name: u.name,
        username: u.username || null,
        branchId: u.branchId!,
        branchName: core.branches.find((b) => b.id === u.branchId)?.name ?? '',
        grade: u.grade ?? 0,
        sectionName: core.sections.find((s) => s.id === u.sectionId)?.name ?? null,
        status,
        planName: paying ? 'Annual plan' : null,
        periodEnd: paying ? new Date(status === 'active' ? '2027-03-31T00:00:00Z' : '2026-09-30T00:00:00Z') : null,
      };
    })
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.grade - b.grade || a.name.localeCompare(b.name));
}

export function loadSchoolDashboard(core: CoreSeed, school: SchoolSlice, actor: CoreUser | null, q: SchoolQuery) {
  const grade = parseGrade(q.grade);
  const status = parseStatus(q.status);
  const branchId = q.branchId || undefined;
  const allSummary = enrollmentSummaryFor(core, actor);
  const students = listStudentsFor(core, school, actor, { branchId, grade, status });
  const branches = listBranchesFor(core, school, actor);
  const summary = branchId ? allSummary.filter((r) => r.branchId === branchId) : allSummary;
  const totals = summary.reduce<Totals>(
    (t, r) => ({ pending: t.pending + r.pending, active: t.active + r.active, lapsed: t.lapsed + r.lapsed, removed: t.removed + r.removed }),
    { pending: 0, active: 0, lapsed: 0, removed: 0 },
  );
  return { summary, students, branches, totals, canFilterBranch: isSchoolAdmin(actor) };
}

export function listTeachersFor(core: CoreSeed, actor: CoreUser | null): TeacherListing[] {
  const visible = new Set(scopeBranches(core, actor).map((b) => b.id));
  return core.users
    .filter((u) => u.role === 'teacher' && u.branchId && visible.has(u.branchId))
    .map((u) => ({ userId: u.id, name: u.name, username: u.username || null, branchId: u.branchId!, branchName: core.branches.find((b) => b.id === u.branchId)?.name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSchoolSetup(core: CoreSeed, school: SchoolSlice, actor: CoreUser | null) {
  return {
    branches: listBranchesFor(core, school, actor),
    subjects: [...core.subjects].sort((a, b) => a.name.localeCompare(b.name)),
    teachers: listTeachersFor(core, actor),
    canManageSubjects: isSchoolAdmin(actor),
  };
}
