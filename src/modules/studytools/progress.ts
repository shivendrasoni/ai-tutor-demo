import { sql, type SQL } from 'drizzle-orm';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy';

export type ChapterProgressRow = {
  studentId: string;
  subjectId: string;
  chapterId: string;
  chapterTitle: string;
  scored: number;
  max: number;
  attempts: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validIds = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)).map((i) => i.toLowerCase()))] : [];

/** Role-scoped predicate over `att` (attempts), `a` (artifacts) and `sp` (student_profiles). Throws FORBIDDEN for anyone else. */
function scopePredicate(actor: Actor): SQL {
  if (actor.isPlatformAdmin || !actor.schoolId) throw new DomainError('FORBIDDEN');
  if (actor.roles.includes('school_admin')) return sql`true`;
  if (actor.roles.includes('branch_admin')) {
    if (!actor.branchId) throw new DomainError('FORBIDDEN');
    return sql`sp.branch_id = ${actor.branchId}::uuid`;
  }
  if (actor.roles.includes('teacher')) {
    return sql`exists (
      select 1 from teacher_assignments ta
      where ta.teacher_id = ${actor.userId}::uuid
        and ta.school_id = ${actor.schoolId}::uuid
        and ta.section_id = sp.section_id
        and ta.subject_id = a.subject_id)`;
  }
  if (actor.roles.includes('student')) return sql`att.student_id = ${actor.userId}::uuid`;
  throw new DomainError('FORBIDDEN');
}

/**
 * Per-student, per-subject, per-chapter totals over graded attempts. Scoping is in SQL (RLS only isolates the school).
 * Titles come from the newest artifact's `params.chapterTitles` snapshot, so deleted chapters keep a title.
 * Removed students are excluded; lapsed students stay (their history is still meaningful). Rows are ordered by student, subject, chapter id.
 */
export async function chapterProgress(
  actor: Actor,
  opts: { studentIds?: string[]; subjectId?: string } = {},
): Promise<ChapterProgressRow[]> {
  const scope = scopePredicate(actor);
  const schoolId = actor.schoolId!;
  const isStudentOnly =
    !actor.roles.includes('school_admin') && !actor.roles.includes('branch_admin') && !actor.roles.includes('teacher');
  const conds: SQL[] = [scope];
  if (opts.studentIds !== undefined && !isStudentOnly) {
    const ids = validIds(opts.studentIds);
    if (ids.length === 0) return [];
    conds.push(sql`att.student_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }
  if (opts.subjectId !== undefined) {
    const [sid] = validIds([opts.subjectId]);
    if (!sid) return [];
    conds.push(sql`a.subject_id = ${sid}::uuid`);
  }
  const rows = await runAs(actor, async (tx) => {
    const res = await tx.execute(sql`
      select att.student_id as "studentId",
             a.subject_id as "subjectId",
             e.key as "chapterId",
             coalesce((array_agg(a.params -> 'chapterTitles' ->> e.key order by a.created_at desc, a.id desc)
               filter (where a.params -> 'chapterTitles' ->> e.key is not null))[1], e.key) as "chapterTitle",
             sum((e.value ->> 'scored')::numeric)::float8 as scored,
             sum((e.value ->> 'max')::numeric)::float8 as max,
             count(*)::int as attempts
      from attempts att
      join artifacts a on a.id = att.artifact_id and a.school_id = att.school_id
      join student_profiles sp on sp.user_id = att.student_id and sp.school_id = att.school_id
      cross join lateral jsonb_each(case when jsonb_typeof(att.by_chapter) = 'object' then att.by_chapter else '{}'::jsonb end) e
      where att.school_id = ${schoolId}::uuid
        and att.status = 'graded'
        and sp.status <> 'removed'
        and ${sql.join(conds, sql` and `)}
      group by att.student_id, a.subject_id, e.key
      order by att.student_id, a.subject_id, e.key`);
    return res.rows as ChapterProgressRow[];
  });
  return rows.map((r) => ({ ...r, scored: Number(r.scored), max: Number(r.max), attempts: Number(r.attempts) }));
}
