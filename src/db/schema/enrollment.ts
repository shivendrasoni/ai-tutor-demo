import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { branches, schools, sections } from './tenancy';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const studentProfiles = pgTable(
  'student_profiles',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    grade: integer('grade').notNull(),
    sectionId: uuid('section_id').references(() => sections.id),
    parentName: text('parent_name').notNull(),
    parentPhone: text('parent_phone').notNull(),
    parentEmail: text('parent_email'),
    status: text('status').notNull().default('pending_payment'),
    createdAt: createdAt(),
  },
  (t) => [
    check('student_profiles_grade_check', sql`${t.grade} between 5 and 12`),
    check('student_profiles_status_check', sql`${t.status} in ('pending_payment','active','lapsed','removed')`),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: id(),
    name: text('name').notNull(),
    interval: text('interval').notNull(),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check('plans_interval_check', sql`${t.interval} in ('monthly','annual')`)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    studentId: uuid('student_id').notNull().unique().references(() => users.id),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    status: text('status').notNull().default('pending'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check('subscriptions_status_check', sql`${t.status} in ('pending','active','lapsed','cancelled')`)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    subscriptionId: uuid('subscription_id').notNull().references(() => subscriptions.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    method: text('method').notNull(),
    externalRef: text('external_ref'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    recordedBy: uuid('recorded_by').notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('payments_method_check', sql`${t.method} in ('manual_link','gateway')`),
    // Idempotency: one payment per (subscription, external reference).
    uniqueIndex('payments_subscription_external_ref_unique')
      .on(t.subscriptionId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

export const invites = pgTable('invites', {
  id: id(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  studentUserId: uuid('student_user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});
