import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branches, schools, sections, subjects } from './tenancy';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username'),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_unique').on(t.username)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    branchId: uuid('branch_id').references(() => branches.id),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_user_school_unique').on(t.userId, t.schoolId),
    check('memberships_role_check', sql`${t.role} in ('school_admin','branch_admin','teacher','student')`),
  ],
);

export const teacherAssignments = pgTable(
  'teacher_assignments',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    teacherId: uuid('teacher_id').notNull().references(() => users.id),
    sectionId: uuid('section_id').notNull().references(() => sections.id),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teacherId, t.sectionId, t.subjectId] })],
);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
