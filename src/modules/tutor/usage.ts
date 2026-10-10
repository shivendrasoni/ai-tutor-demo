import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { usageDaily } from '@/db/schema';
import { dailyTokenLimit } from './config';

const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/** Atomic upsert into usage_daily (UTC day); a null cost adds nothing. */
export async function recordUsage(
  tx: Tx,
  a: { schoolId: string; studentId: string; tokens: number; cost: number | null; now?: Date },
): Promise<void> {
  const cost = String(a.cost ?? 0);
  await tx
    .insert(usageDaily)
    .values({ schoolId: a.schoolId, studentId: a.studentId, date: utcDate(a.now ?? new Date()), tokens: a.tokens, cost })
    .onConflictDoUpdate({
      target: [usageDaily.studentId, usageDaily.date],
      set: {
        tokens: sql`${usageDaily.tokens} + excluded.tokens`,
        cost: sql`${usageDaily.cost} + excluded.cost`,
      },
    });
}

export async function todayTokens(tx: Tx, studentId: string, now: Date = new Date()): Promise<number> {
  const rows = await tx
    .select({ tokens: usageDaily.tokens })
    .from(usageDaily)
    .where(and(eq(usageDaily.studentId, studentId), eq(usageDaily.date, utcDate(now))));
  return rows[0]?.tokens ?? 0;
}

/** True when today's usage has reached the limit (usage == limit counts as exhausted). */
export async function isBudgetExhausted(tx: Tx, studentId: string, now: Date = new Date()): Promise<boolean> {
  return (await todayTokens(tx, studentId, now)) >= dailyTokenLimit();
}
