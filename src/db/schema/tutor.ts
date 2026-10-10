import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { schools, subjects } from './tenancy';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const schoolId = () => uuid('school_id').notNull().references(() => schools.id);

/** Global (no school_id, no RLS); app_user may read but not write (see 0008_tutor_rls.sql). */
export const skills = pgTable(
  'skills',
  {
    id: id(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    instructions: text('instructions').notNull(),
    models: jsonb('models').notNull().default({}),
    tools: text('tools').array().notNull().default(sql`'{}'::text[]`),
    outputSchema: jsonb('output_schema'),
    providerOptions: jsonb('provider_options'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [check('skills_kind_check', sql`${t.kind} in ('chat','generator','grader')`)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: uuid('student_id').notNull().references(() => users.id),
    skillId: uuid('skill_id').notNull().references(() => skills.id),
    subjectId: uuid('subject_id').references(() => subjects.id),
    title: text('title'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_student_updated_idx').on(t.studentId, t.updatedAt.desc())],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    schoolId: schoolId(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').notNull().default([]),
    retrievedChunkIds: uuid('retrieved_chunk_ids').array().notNull().default(sql`'{}'::uuid[]`),
    decisions: jsonb('decisions'),
    model: text('model'),
    modelTier: text('model_tier'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    cost: numeric('cost'),
    latencyMs: integer('latency_ms'),
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),
    feedback: text('feedback'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('messages_role_check', sql`${t.role} in ('user','assistant')`),
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
  ],
);

export const usageDaily = pgTable(
  'usage_daily',
  {
    schoolId: schoolId(),
    studentId: uuid('student_id').notNull().references(() => users.id),
    date: date('date').notNull(),
    tokens: integer('tokens').notNull().default(0),
    cost: numeric('cost').notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.date] })],
);
