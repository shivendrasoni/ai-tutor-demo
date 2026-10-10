import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform } from '@/db/client';
import { isUniqueViolation } from '@/db/pgerror';
import { DomainError } from '@/lib/errors';
import { isUuid } from '@/lib/uuid';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { addInterval, type PlanInterval } from './periods';

export type PendingRow = {
  subscriptionId: string;
  status: string;
  studentName: string;
  username: string | null;
  schoolName: string;
  branchName: string;
  grade: number;
  parentName: string;
  parentPhone: string;
  planName: string;
  priceMinor: number;
  currency: string;
  createdAt: Date;
};

const INT4_MAX = 2147483647;
const PaymentSchema = z.object({
  amountMinor: z.number().int().positive().max(INT4_MAX),
  currency: z.string().regex(/^[A-Z]{3}$/),
  externalRef: z.string().trim().min(1).max(200).optional(),
  paidAt: z.date().refine((d) => !Number.isNaN(d.getTime())),
});

export async function recordPayment(
  actor: Actor,
  input: { subscriptionId: string; amountMinor: number; currency: string; externalRef?: string; paidAt: Date },
  now: Date = new Date(),
): Promise<{ periodStart: Date; periodEnd: Date }> {
  requirePlatform(actor);
  if (!isUuid(input.subscriptionId)) throw new DomainError('NOT_FOUND', 'Subscription not found');
  // Accept "inr" / " INR ": normalize before the strict ISO-4217-shape check.
  const normalized = { ...input, currency: typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : input.currency };
  const parsed = PaymentSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid payment', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { amountMinor, currency, externalRef, paidAt } = parsed.data;
  if (paidAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new DomainError('VALIDATION', 'paidAt cannot be in the future', { field: 'paidAt' });
  }
  if (paidAt.getTime() < now.getTime() - 365 * 86_400_000) {
    throw new DomainError('VALIDATION', 'paidAt cannot be more than a year ago', { field: 'paidAt' });
  }

  try {
    return await withPlatform(async (tx) => {
      // Lock the subscription first (same order as removeStudent) so concurrent payments serialize.
      const locked = await tx.execute(sql`
        select s.id, s.school_id, s.student_id, s.status, s.current_period_start, s.current_period_end, p.interval
        from subscriptions s join plans p on p.id = s.plan_id
        where s.id = ${input.subscriptionId} for update of s`);
      const sub = locked.rows[0] as
        | {
            school_id: string; student_id: string; status: string;
            current_period_start: Date | string | null; current_period_end: Date | string | null; interval: string;
          }
        | undefined;
      if (!sub) throw new DomainError('NOT_FOUND', 'Subscription not found');

      const prof = await tx.execute(sql`select status from student_profiles where user_id = ${sub.student_id} for update`);
      if (prof.rows[0]?.status === 'removed') throw new DomainError('STUDENT_REMOVED', 'Student has been removed');
      if (sub.status === 'cancelled') throw new DomainError('VALIDATION', 'Subscription is cancelled');

      await tx.execute(sql`
        insert into payments (school_id, subscription_id, amount_minor, currency, method, external_ref, paid_at, recorded_by)
        values (${sub.school_id}, ${input.subscriptionId}, ${amountMinor}, ${currency}, 'manual_link',
                ${externalRef ?? null}, ${paidAt.toISOString()}::timestamptz, ${actor.userId})`);

      const interval = sub.interval as PlanInterval;
      const end = sub.current_period_end ? new Date(sub.current_period_end) : null;
      let periodStart: Date;
      let periodEnd: Date;
      if (sub.status === 'active' && end && end.getTime() >= paidAt.getTime() && sub.current_period_start) {
        periodStart = new Date(sub.current_period_start);
        periodEnd = addInterval(end, interval);
      } else {
        periodStart = paidAt;
        periodEnd = addInterval(paidAt, interval);
      }
      await tx.execute(sql`
        update subscriptions set status = 'active',
          current_period_start = ${periodStart.toISOString()}::timestamptz,
          current_period_end = ${periodEnd.toISOString()}::timestamptz
        where id = ${input.subscriptionId}`);
      await tx.execute(sql`update student_profiles set status = 'active' where user_id = ${sub.student_id}`);
      return { periodStart, periodEnd };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'payments_subscription_external_ref_unique')) {
      throw new DomainError('VALIDATION', 'This payment reference was already recorded', { reason: 'duplicate_payment' });
    }
    throw e;
  }
}

export async function listPendingSubscriptions(actor: Actor): Promise<PendingRow[]> {
  requirePlatform(actor);
  const res = await withPlatform((tx) =>
    tx.execute(sql`
      select s.id as "subscriptionId", s.status, u.name as "studentName", u.username,
             sc.name as "schoolName", b.name as "branchName", sp.grade,
             sp.parent_name as "parentName", sp.parent_phone as "parentPhone",
             p.name as "planName", p.price_minor as "priceMinor", p.currency, s.created_at as "createdAt"
      from subscriptions s
      join student_profiles sp on sp.user_id = s.student_id
      join users u on u.id = s.student_id
      join schools sc on sc.id = s.school_id
      join branches b on b.id = sp.branch_id
      join plans p on p.id = s.plan_id
      where s.status in ('pending','lapsed') and sp.status <> 'removed'
      order by s.created_at, s.id`),
  );
  return res.rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt as string | Date) })) as PendingRow[];
}
