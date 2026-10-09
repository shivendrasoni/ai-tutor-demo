import { and, eq, inArray, lt } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles, subscriptions } from '@/db/schema';

/** Lapses every active subscription whose period ended before `now`, plus its active profile. */
export async function lapseExpired(now: Date): Promise<number> {
  return withPlatform(async (tx) => {
    const rows = await tx
      .update(subscriptions)
      .set({ status: 'lapsed' })
      .where(and(eq(subscriptions.status, 'active'), lt(subscriptions.currentPeriodEnd, now)))
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
