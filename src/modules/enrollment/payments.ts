import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform } from '@/db/client';
import {
  branches, payments, plans, schools, studentProfiles, subscriptions, users,
} from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { addInterval, type PlanInterval } from './periods';

const PaymentSchema = z.object({
  amountMinor: z.number().int().positive().max(2147483647), // int4 column
  currency: z.string().regex(/^[A-Z]{3}$/),
  externalRef: z.string().trim().min(1).max(200).optional(),
  paidAt: z.date().refine((d) => !Number.isNaN(d.getTime())),
});

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;
const notFound = () => new DomainError('NOT_FOUND', 'Subscription not found');

export async function recordPayment(
  actor: Actor,
  input: { subscriptionId: string; amountMinor: number; currency: string; externalRef?: string; paidAt: Date },
): Promise<{ periodStart: Date; periodEnd: Date }> {
  requirePlatform(actor);
  if (!isUuid(input.subscriptionId)) throw notFound();
  const parsed = PaymentSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid payment details', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { amountMinor, currency, externalRef, paidAt } = parsed.data;

  return withPlatform(async (tx) => {
    // Row lock serializes concurrent payments on the same subscription.
    const locked = await tx.execute(
      sql`select id from subscriptions where id = ${input.subscriptionId} for update`,
    );
    if (locked.rows.length === 0) throw notFound();

    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId));
    const [profile] = await tx.select().from(studentProfiles).where(eq(studentProfiles.userId, sub.studentId));
    const [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId));

    if (profile.status === 'removed') throw new DomainError('STUDENT_REMOVED', 'Student has been removed');
    // A cancelled subscription only arises from removal, so reaching here is inconsistent state.
    if (sub.status === 'cancelled') throw new DomainError('VALIDATION', 'Subscription is cancelled');

    const interval = plan.interval as PlanInterval;
    // Active subscriptions extend from the current end. If the end is already in the past relative
    // to paidAt (the lapse job hasn't run yet), treat it as lapsed and restart from paidAt.
    const extending =
      sub.status === 'active' && sub.currentPeriodStart && sub.currentPeriodEnd && sub.currentPeriodEnd >= paidAt;
    const periodStart = extending ? sub.currentPeriodStart! : paidAt;
    const periodEnd = addInterval(extending ? sub.currentPeriodEnd! : paidAt, interval);

    await tx.insert(payments).values({
      schoolId: sub.schoolId,
      subscriptionId: sub.id,
      amountMinor,
      currency,
      method: 'manual_link',
      externalRef: externalRef ?? null,
      paidAt,
      recordedBy: actor.userId,
    });
    await tx
      .update(subscriptions)
      .set({ status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd })
      .where(eq(subscriptions.id, sub.id));
    await tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, sub.studentId));
    return { periodStart, periodEnd };
  });
}

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

export async function listPendingSubscriptions(actor: Actor): Promise<PendingRow[]> {
  requirePlatform(actor);
  return withPlatform((tx) =>
    tx
      .select({
        subscriptionId: subscriptions.id,
        status: subscriptions.status,
        studentName: users.name,
        username: users.username,
        schoolName: schools.name,
        branchName: branches.name,
        grade: studentProfiles.grade,
        parentName: studentProfiles.parentName,
        parentPhone: studentProfiles.parentPhone,
        planName: plans.name,
        priceMinor: plans.priceMinor,
        currency: plans.currency,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.studentId))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, subscriptions.studentId))
      .innerJoin(schools, eq(schools.id, subscriptions.schoolId))
      .innerJoin(branches, eq(branches.id, studentProfiles.branchId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(inArray(subscriptions.status, ['pending', 'lapsed']), ne(studentProfiles.status, 'removed')))
      .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id)),
  );
}
