import { eq, sql, type SQL } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles } from '@/db/schema';
import type { StudentStatus } from '@/modules/tenancy/actor';

/**
 * SQL mirror of the read-time lapse rule. Needs `student_profiles` and a (left) joined `subscriptions` in the query:
 * a stored 'active' student whose period ended (strict `<`) is 'lapsed'; a null period end never lapses;
 * every other stored status is returned unchanged.
 */
export function effectiveStatusSql(now: Date): SQL<StudentStatus> {
  return sql<StudentStatus>`(case when student_profiles.status = 'active' and subscriptions.current_period_end < ${now.toISOString()}::timestamptz then 'lapsed' else student_profiles.status end)`;
}

/**
 * Flips active subscriptions whose period ended (`current_period_end < now`) to lapsed, together with their
 * active profiles. Optionally limited to one student. Returns the number of subscriptions lapsed.
 * Lock order (subscription, then profile) matches recordPayment and removeStudent.
 */
export async function lapseExpired(now: Date, onlyStudentId?: string): Promise<number> {
  return withPlatform(async (tx) => {
    const lapsed = await tx.execute(sql`
      update subscriptions set status = 'lapsed'
      where status = 'active'
        and current_period_end < ${now.toISOString()}::timestamptz
        ${onlyStudentId ? sql`and student_id = ${onlyStudentId}` : sql``}
      returning student_id`);
    const ids = lapsed.rows.map((r) => String(r.student_id));
    if (ids.length > 0) {
      await tx.execute(sql`
        update student_profiles set status = 'lapsed'
        where status = 'active' and user_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    }
    return ids.length;
  });
}

/** Read-time rule: the stored status, except an active student whose period ended is lapsed (and flipped now). Null if no profile. */
export async function effectiveStudentStatus(studentUserId: string, now: Date = new Date()): Promise<StudentStatus | null> {
  const [row] = await withPlatform((tx) =>
    tx.select({ status: studentProfiles.status }).from(studentProfiles).where(eq(studentProfiles.userId, studentUserId)),
  );
  if (!row) return null;
  if (row.status !== 'active') return row.status as StudentStatus;
  const flipped = await lapseExpired(now, studentUserId);
  return flipped > 0 ? 'lapsed' : 'active';
}
