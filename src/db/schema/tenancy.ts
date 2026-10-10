import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const schools = pgTable('schools', {
  id: id(),
  name: text('name').notNull(),
  board: text('board').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
});

export const branches = pgTable('branches', {
  id: id(),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  signupCode: text('signup_code').notNull().unique(),
  signupCodeEnabled: boolean('signup_code_enabled').notNull().default(true),
  createdAt: createdAt(),
});

export const sections = pgTable(
  'sections',
  {
    id: id(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    grade: integer('grade').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sections_branch_grade_name_unique').on(t.branchId, t.grade, t.name),
    check('sections_grade_check', sql`${t.grade} between 5 and 12`),
  ],
);

export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('subjects_school_name_unique').on(t.schoolId, t.name)],
);
