import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { skills } from './tutor';
import { schools, subjects } from './tenancy';

const id = () => uuid('id').primaryKey().defaultRandom();
const schoolId = () => uuid('school_id').notNull().references(() => schools.id);

/** Global (no school_id, no RLS); app_user may read but not write (see 0010_study_rls.sql). Seeded by that migration. */
export const examPatterns = pgTable('exam_patterns', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  gradeMin: integer('grade_min').notNull(),
  gradeMax: integer('grade_max').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  sections: jsonb('sections').notNull(),
});

export const artifacts = pgTable(
  'artifacts',
  {
    id: id(),
    schoolId: schoolId(),
    studentId: uuid('student_id').notNull().references(() => users.id),
    skillId: uuid('skill_id').notNull().references(() => skills.id),
    type: text('type').notNull(),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id),
    chapterIds: uuid('chapter_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** `{ questionCount?, patternKey?, chapterTitles: Record<chapterId, string> }` */
    params: jsonb('params').notNull().default({}),
    status: text('status').notNull(),
    error: text('error'),
    content: jsonb('content'),
    sourceChunkIds: uuid('source_chunk_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('artifacts_type_check', sql`${t.type} in ('practice_test','mock_exam','study_notes','last_night_notes')`),
    check('artifacts_status_check', sql`${t.status} in ('generating','ready','failed')`),
    index('artifacts_student_created_idx').on(t.studentId, t.createdAt),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    schoolId: schoolId(),
    artifactId: uuid('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => users.id),
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    answers: jsonb('answers').notNull().default({}),
    results: jsonb('results'),
    score: numeric('score'),
    maxScore: numeric('max_score'),
    byChapter: jsonb('by_chapter'),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    /** Last time stuck-grading recovery re-enqueued this attempt's jobs; rate-limits recovery. */
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
  },
  (t) => [
    check('attempts_status_check', sql`${t.status} in ('in_progress','grading','graded')`),
    index('attempts_student_artifact_idx').on(t.studentId, t.artifactId),
  ],
);
