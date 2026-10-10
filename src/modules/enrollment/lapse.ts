import { and, eq, inArray, lt } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles, subscriptions } from '@/db/schema';
import type { StudentStatus } from '@/modules/tenancy/actor';

/**
 * Lapses every active subscription whose period ended before `now`, plus its active profile.
 * `onlyStudentId` limits it to one student (used for read-time lapse).
 */
export async function lapseExpired(now: Date, onlyStudentId?: string): Promise<number> {
  return withPlatform(async (tx) => {
    const rows = await tx
      .update(subscriptions)
      .set({ status: 'lapsed' })
      .where(
        and(
          eq(subscriptions.status, 'active'),
          lt(subscriptions.currentPeriodEnd, now),
          onlyStudentId ? eq(subscriptions.studentId, onlyStudentId) : undefined,
        ),
      )
      .returning({ studentId: subscriptions.studentId });
    if (rows.length > 0) {
      await tx
        .update(studentProfiles)
        .set({ status: 'lapsed' })
        .where(
          and(eq(studentProfiles.status, 'active'), inArray(studentProfiles.userId, rows.map((r) => r.studentId))),
        );
    }
    return rows.length;
  });
}

/** True when an `active` student's subscription period has already ended at `now`. */
export const isPeriodExpired = (periodEnd: Date | null | undefined, now: Date): boolean =>
  !!periodEnd && periodEnd.getTime() < now.getTime();

/**
 * The single source of truth for "may this student use the product": the stored status, except that an
 * `active` student whose period has ended is `lapsed` even if the daily job has not run yet (the rows are
 * flipped here too). Null when there is no such student profile.
 */
export async function effectiveStudentStatus(studentUserId: string, now: Date = new Date()): Promise<StudentStatus | null> {
  const [row] = await withPlatform((tx) =>
    tx
      .select({ status: studentProfiles.status, periodEnd: subscriptions.currentPeriodEnd })
      .from(studentProfiles)
      .leftJoin(subscriptions, eq(subscriptions.studentId, studentProfiles.userId))
      .where(eq(studentProfiles.userId, studentUserId)),
  );
  if (!row) return null;
  if (row.status === 'active' && isPeriodExpired(row.periodEnd, now)) {
    await lapseExpired(now, studentUserId);
    return 'lapsed';
  }
  return row.status as StudentStatus;
}
