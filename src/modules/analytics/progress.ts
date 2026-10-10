import { sql } from 'drizzle-orm';
import { DomainError } from '@/lib/errors';
import { listVisibleChapters } from '@/modules/content';
import { chapterProgress } from '@/modules/studytools';
import type { Actor } from '@/modules/tenancy/actor';
import { canManageBranch, runAs } from '@/modules/tenancy/authz';

export type SectionProgress = {
  students: { studentId: string; name: string; chapters: { chapterId: string; ratio: number | null; attempts: number }[] }[];
  chapters: { chapterId: string; title: string; avgRatio: number | null; weak: boolean }[];
};

export type TeacherAssignment = {
  sectionId: string; sectionName: string; grade: number; subjectId: string; subjectName: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const ratio = (scored: number, max: number): number | null => (max > 0 ? scored / max : null);

export async function sectionProgress(
  actor: Actor,
  args: { sectionId: string; subjectId: string },
): Promise<SectionProgress> {
  const { sectionId, subjectId } = args ?? ({} as { sectionId: string; subjectId: string });
  const isAdmin = actor.roles.includes('school_admin') || actor.roles.includes('branch_admin');
  const isTeacher = actor.roles.includes('teacher');
  if (actor.isPlatformAdmin || !actor.schoolId || (!isAdmin && !isTeacher)) throw new DomainError('FORBIDDEN');
  if (!isUuid(sectionId) || !isUuid(subjectId)) throw new DomainError('NOT_FOUND');
  const schoolId = actor.schoolId;

  // Authorize and load the roster in one tenant transaction.
  const { section, roster } = await runAs(actor, async (tx) => {
    const sec = (
      await tx.execute(sql`select id, branch_id as "branchId", grade from sections where id = ${sectionId}::uuid and school_id = ${schoolId}::uuid`)
    ).rows[0] as { id: string; branchId: string; grade: number } | undefined;
    if (!sec) throw new DomainError('NOT_FOUND');
    if (isAdmin) {
      if (!canManageBranch(actor, schoolId, sec.branchId)) throw new DomainError('FORBIDDEN');
    } else {
      const asg = await tx.execute(sql`select 1 from teacher_assignments
        where teacher_id = ${actor.userId}::uuid and section_id = ${sectionId}::uuid and subject_id = ${subjectId}::uuid limit 1`);
      if (!asg.rows.length) throw new DomainError('FORBIDDEN');
    }
    const r = await tx.execute(sql`select sp.user_id as "studentId", u.name as "name"
      from student_profiles sp join users u on u.id = sp.user_id
      where sp.section_id = ${sectionId}::uuid and sp.school_id = ${schoolId}::uuid and sp.status <> 'removed'
      order by u.name, sp.user_id`);
    return { section: sec, roster: r.rows as { studentId: string; name: string }[] };
  });

  // Only chapters currently visible to the section are listed; a chapter with graded attempts that is no longer
  // visible (deleted or hidden) is omitted.
  const visible = await listVisibleChapters(
    { schoolId, branchId: section.branchId, sectionId, grade: section.grade },
    subjectId,
  );
  const rows = roster.length
    ? await chapterProgress(actor, { studentIds: roster.map((s) => s.studentId), subjectId })
    : [];
  const byKey = new Map(rows.map((r) => [`${r.studentId}:${r.chapterId}`, r]));

  const students = roster.map((s) => ({
    studentId: s.studentId,
    name: s.name,
    chapters: visible.map((c) => {
      const p = byKey.get(`${s.studentId}:${c.id}`);
      return { chapterId: c.id, ratio: p ? ratio(p.scored, p.max) : null, attempts: p?.attempts ?? 0 };
    }),
  }));
  const chapters = visible.map((c) => {
    let scored = 0;
    let max = 0;
    for (const s of roster) {
      const p = byKey.get(`${s.studentId}:${c.id}`);
      if (p) { scored += p.scored; max += p.max; }
    }
    const avgRatio = ratio(scored, max);
    return { chapterId: c.id, title: c.title, avgRatio, weak: avgRatio !== null && avgRatio < 0.5 };
  });
  return { students, chapters };
}

export async function listTeacherAssignments(actor: Actor): Promise<TeacherAssignment[]> {
  if (actor.isPlatformAdmin || !actor.schoolId || !actor.roles.includes('teacher')) throw new DomainError('FORBIDDEN');
  return runAs(actor, async (tx) => {
    const res = await tx.execute(sql`select s.id as "sectionId", s.name as "sectionName", s.grade as "grade",
        sub.id as "subjectId", sub.name as "subjectName"
      from teacher_assignments ta
      join sections s on s.id = ta.section_id
      join subjects sub on sub.id = ta.subject_id
      where ta.teacher_id = ${actor.userId}::uuid
      order by s.grade, s.name, sub.name, s.id, sub.id`);
    return res.rows.map((r) => ({
      sectionId: r.sectionId as string, sectionName: r.sectionName as string, grade: Number(r.grade),
      subjectId: r.subjectId as string, subjectName: r.subjectName as string,
    }));
  });
}
