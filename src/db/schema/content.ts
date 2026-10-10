import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { branches, schools, sections, subjects } from './tenancy';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const schoolId = () => uuid('school_id').notNull().references(() => schools.id);

export const contentItems = pgTable(
  'content_items',
  {
    id: id(),
    schoolId: schoolId(),
    grade: integer('grade').notNull(),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    branchId: uuid('branch_id').references(() => branches.id),
    sectionId: uuid('section_id').references(() => sections.id),
    title: text('title').notNull(),
    fileKey: text('file_key').notNull(),
    uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
    ingestStatus: text('ingest_status').notNull().default('queued'),
    ingestError: text('ingest_error'),
    pageCount: integer('page_count'),
    ocrPages: integer('ocr_pages').notNull().default(0),
    ocrSkippedPages: integer('ocr_skipped_pages').notNull().default(0),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
    /** Last status change or re-queue; the stuck-ingest check measures from here, not from upload. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (t) => [
    check('content_items_grade_check', sql`${t.grade} between 5 and 12`),
    check('content_items_kind_check', sql`${t.kind} in ('book','material')`),
    check('content_items_scope_values_check', sql`${t.scope} in ('school','branch','section')`),
    check(
      'content_items_ingest_status_check',
      sql`${t.ingestStatus} in ('queued','processing','ready','failed')`,
    ),
    check(
      'content_items_scope_check',
      sql`(${t.scope} = 'school' and ${t.branchId} is null and ${t.sectionId} is null)
        or (${t.scope} = 'branch' and ${t.branchId} is not null and ${t.sectionId} is null)
        or (${t.scope} = 'section' and ${t.branchId} is not null and ${t.sectionId} is not null)`,
    ),
  ],
);

export const contentExclusions = pgTable(
  'content_exclusions',
  {
    schoolId: schoolId(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.contentItemId] })],
);

export const contentChapters = pgTable('content_chapters', {
  id: id(),
  schoolId: schoolId(),
  contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  title: text('title').notNull(),
  pageStart: integer('page_start').notNull(),
  pageEnd: integer('page_end').notNull(),
});

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    schoolId: schoolId(),
    contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').notNull().references(() => contentChapters.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    text: text('text').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddingModel: text('embedding_model'),
    embeddingDim: integer('embedding_dim'),
  },
  (t) => [
    index('chunks_school_item_idx').on(t.schoolId, t.contentItemId),
    index('chunks_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);
