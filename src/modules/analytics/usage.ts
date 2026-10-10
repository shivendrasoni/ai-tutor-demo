import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { sections, teacherAssignments } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy/authz';
import { windowStart } from './window';

export type StudentUsageRow = {
  studentId: string;
  name: string;
  sectionName: string | null;
  messages7d: number;
  messages30d: number;
  lastActiveAt: Date | null;
};

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

/** Counts the student's own (`role = 'user'`) messages; `removed` students are excluded. */
export async function studentUsage(
  actor: Actor,
  args: { sectionId?: string; subjectId?: string; now?: Date },
): Promise<StudentUsageRow[]> {
  const { sectionId, subjectId } = args ?? {};
  const now = args?.now ?? new Date();
  const isSchoolAdmin = actor.roles.includes('school_admin');
  const isBranchAdmin = actor.roles.includes('branch_admin');
  const isTeacher = actor.roles.includes('teacher');
  // Platform admins have no school scope here; students never see usage.
  if (actor.isPlatformAdmin || !actor.schoolId || (!isSchoolAdmin && !isBranchAdmin && !isTeacher)) {
    throw new DomainError('FORBIDDEN');
  }
  if (sectionId !== undefined && !isUuid(sectionId)) throw new DomainError('FORBIDDEN');
  if (subjectId !== undefined && !isUuid(subjectId)) throw new DomainError('FORBIDDEN');
  const branchScope = isSchoolAdmin ? null : actor.branchId;
  if (!isSchoolAdmin && !isTeacher && !branchScope) throw new DomainError('FORBIDDEN');

  const start7 = windowStart(now, 7).toISOString();
  const start30 = windowStart(now, 30).toISOString();
  const schoolId = actor.schoolId;

  return runAs(actor, async (tx) => {
    let scope = sql`sp.school_id = ${schoolId} and sp.status <> 'removed'`;
    if (sectionId) {
      const [sec] = await tx
        .select({ id: sections.id, branchId: sections.branchId })
        .from(sections)
        .where(sql`${sections.id} = ${sectionId} and ${sections.schoolId} = ${schoolId}`);
      if (!sec || (branchScope && sec.branchId !== branchScope && !isTeacher)) throw new DomainError('FORBIDDEN');
      if (isTeacher && !isSchoolAdmin && !isBranchAdmin) {
        const [asg] = await tx
          .select({ sectionId: teacherAssignments.sectionId })
          .from(teacherAssignments)
          .where(sql`${teacherAssignments.teacherId} = ${actor.userId} and ${teacherAssignments.sectionId} = ${sectionId}`)
          .limit(1);
        if (!asg) throw new DomainError('FORBIDDEN');
      }
      scope = sql`${scope} and sp.section_id = ${sectionId}`;
    }
    if (!isSchoolAdmin && !isBranchAdmin) {
      scope = sql`${scope} and sp.section_id in (select section_id from teacher_assignments where teacher_id = ${actor.userId})`;
    } else if (branchScope) {
      scope = sql`${scope} and sp.branch_id = ${branchScope}`;
    }
    const subjectJoin = subjectId ? sql` and c.subject_id = ${subjectId}` : sql``;

    const res = await tx.execute(sql`
      select sp.user_id as "studentId", u.name as "name", s.name as "sectionName",
        (count(m.id) filter (where m.created_at >= ${start7}::timestamptz))::int as "messages7d",
        (count(m.id) filter (where m.created_at >= ${start30}::timestamptz))::int as "messages30d",
        max(m.created_at) as "lastActiveAt"
      from student_profiles sp
      join users u on u.id = sp.user_id
      left join sections s on s.id = sp.section_id
      left join conversations c on c.student_id = sp.user_id${subjectJoin}
      left join messages m on m.conversation_id = c.id and m.role = 'user'
      where ${scope}
      group by sp.user_id, u.name, s.name
      order by u.name, sp.user_id`);
    return res.rows.map((r) => ({
      studentId: r.studentId as string,
      name: r.name as string,
      sectionName: (r.sectionName as string | null) ?? null,
      messages7d: Number(r.messages7d),
      messages30d: Number(r.messages30d),
      lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt as string | Date) : null,
    }));
  });
}
