# Sub-spec 2: Content & Ingestion

- **Date:** 2026-10-10
- **Parent spec:** `2026-10-10-ai-tutor-architecture-design.md`. This spec covers §3.2 seams `Embedder` and `OcrExtractor`, §4.2, §6.2, module ③, and the content parts of §8.
- **Depends on:** sub-project 1 (tenancy, identity, enrollment). It reuses `Actor`, `runAs`, `withTenant`, `withPlatform`, `DomainError`, the authz helpers, and `tests/helpers/db.ts`.

## 1. Goal
Admins and teachers upload PDFs. A background worker turns each PDF into chapter- and page-labelled chunks with embeddings. Other modules then ask the content module exactly one kind of question: *what can this student see, and which chunks match this query?*

## 2. Decisions
| Topic | Decision |
|---|---|
| Object storage | `BlobStore` interface. `LocalBlobStore` (directory from `BLOB_DIR`, default `.data/blobs`) for dev and test; `S3BlobStore` (`@aws-sdk/client-s3`, works with R2) when `S3_BUCKET` is set |
| Job queue | `pg-boss` on the same Postgres. Queue name `ingest`. The worker runs via `pnpm worker` |
| PDF parsing | `unpdf` for per-page text and the outline. `pdf-lib` to split out a single page for OCR |
| OCR | `OcrExtractor` interface. `ModelOcrExtractor` sends the single-page PDF as an AI SDK `file` part to the model named in `OCR_MODEL` (format `provider/model`); `FakeOcrExtractor` is used in tests. If `OCR_MODEL` is unset, low-text pages are kept with whatever text they have, and the item records `ocr_skipped_pages` |
| OCR trigger | Page text shorter than **200 characters** after whitespace collapse |
| Embeddings | `Embedder` interface. `OpenAIEmbedder` uses AI SDK `embedMany` with `openai.textEmbeddingModel('text-embedding-3-small')`, dimension **1536**, and needs `OPENAI_API_KEY`. `FakeEmbedder` is deterministic feature hashing (lowercased word tokens → 1536 buckets, L2-normalised), so lexical overlap gives cosine similarity in tests |
| Embedder selection | `EMBEDDER=openai` or `fake`. Default: `openai` if `OPENAI_API_KEY` is set, otherwise `fake` |
| Vector column | `vector(1536)` with an HNSW index using `vector_cosine_ops` |
| Chunking | Token estimate = `ceil(chars / 4)`. Target **600** tokens, hard max **800**, overlap **80**. Chunks never cross a chapter boundary. Splitting happens on paragraph breaks, then on sentences |
| Upload limits | PDF only (the first bytes must be `%PDF-`), max **100 MB** |

## 3. Data model changes
This adds the parent spec's §4.2 tables, plus:

```
content_items  + ingest_error text null, page_count int null, ocr_pages int default 0,
                 ocr_skipped_pages int default 0, size_bytes int, created_at
content_chapters  id, school_id, content_item_id fk cascade, ordinal int, title text,
                  page_start int, page_end int
chunks         + ordinal int, token_estimate int, chapter_id fk content_chapters
                 (the `chapter` text column from the parent spec becomes chapter_id + a join)
```

- `content_items`, `content_exclusions`, `content_chapters`, and `chunks` all get forced RLS, using the same policy as sub-project 1.
- Deleting a `content_item` cascades to its chapters and chunks, and its blob is removed.

## 4. Chapter detection (in order)
1. **PDF outline:** use top-level outline entries that resolve to a page. Chapter *i* spans from its page up to the page before entry *i+1*; the last chapter runs to the end of the document.
2. **Heading heuristic:** a page whose first 3 non-empty lines contain a line matching `^(chapter|unit|lesson)\s+([0-9]+|[ivxlc]+)\b` (case-insensitive) starts a new chapter. The title is that line plus the next non-empty line, if that line is under 80 characters.
3. **Fallback:** fixed ranges of 20 pages, titled `Pages {start}–{end}`.

If method 1 or 2 finds no chapter starting on page 1, the pages before the first chapter become a chapter titled `Front matter`.

## 5. Ingestion pipeline
Each job is `{ contentItemId, schoolId }`.

1. Mark the item `processing` and clear `ingest_error`. Delete any existing chapters and chunks for the item, so a retry starts clean.
2. Load the blob and extract the outline and per-page text with `unpdf`.
3. For each low-text page, run `OcrExtractor` and replace that page's text with its output.
4. Detect chapters (§4), then chunk each chapter (§2).
5. Embed the chunks in batches of 96.
6. Insert the chapters and chunks with `embedding_model` and `embedding_dim`.
7. Mark the item `ready` with its `page_count` and OCR counts.

The status change in step 7 and the chunk inserts in step 6 run in **one transaction**, so students never see a partial item.

**Failure handling:**
- pg-boss retries with `retryLimit: 3` and `retryBackoff: true`.
- After the final failure, the item is marked `failed` with a short error message.
- `retryIngest(actor, itemId)` sets the item back to `queued` and enqueues the job again.

## 6. Service interface (`src/modules/content/index.ts`)
```ts
type StudentScope = { schoolId: string; branchId: string; sectionId: string | null; grade: number };
uploadContent(actor, input: { scope: 'school'|'branch'|'section'; schoolId: string; branchId?: string; sectionId?: string;
  grade: number; subjectId: string; kind: 'book'|'material'; title: string; file: { bytes: Uint8Array; filename: string } })
  → Promise<{ id: string }>
listContent(actor, filter: { branchId?: string; grade?: number; subjectId?: string }) → Promise<ContentItemRow[]>
deleteContent(actor, itemId) → Promise<void>
retryIngest(actor, itemId) → Promise<void>
setExclusion(actor, { branchId, contentItemId, excluded: boolean }) → Promise<void>
studentScope(actor) → Promise<StudentScope>          // FORBIDDEN unless actor is an active student
visibleContent(scope: StudentScope) → Promise<VisibleItem[]>      // ready items only
listVisibleSubjects(scope) → Promise<{ id: string; name: string }[]>
listVisibleChapters(scope, subjectId) → Promise<{ id: string; title: string; contentItemId: string; itemTitle: string }[]>
searchChunks(scope, query: string, opts?: { subjectIds?: string[]; chapterIds?: string[]; limit?: number; minSimilarity?: number })
  → Promise<ChunkHit[]>        // default limit 8, default minSimilarity 0.25
chunksForChapters(scope, chapterIds: string[], maxTokens: number) → Promise<ChunkHit[]>   // for study-tool generation
ChunkHit = { chunkId, contentItemId, itemTitle, subjectId, subjectName, chapterId, chapterTitle, pageStart, pageEnd, text, similarity }
```

**Authorization:**
- **Book uploads at school scope:** platform admin or `school_admin`.
- **Branch scope** and **exclusions:** `canManageBranch`.
- **Section-scope materials:** a `teacher` assigned (via `teacher_assignments`) to that section and subject, or `canManageBranch`.
- **Teachers** may only upload `kind = material` with `scope = section`.
- **`listContent`:** managers see everything they can manage. Teachers see their own uploads plus the school and branch items for their assigned grades.
- **`deleteContent`** follows the same rule as uploading at that scope.
- **Validation:** `grade` and `subjectId` must belong to the school, and `sectionId` must be in `branchId` with a matching grade (otherwise `VALIDATION`).

**Visibility** follows the parent spec's §4.2 rule exactly. `searchChunks` and `chunksForChapters` filter by `content_item_id IN visibleContent(scope)` inside `withTenant(scope.schoolId)`. Any `subjectIds` or `chapterIds` that are not visible are silently dropped. `chunksForChapters` returns chunks in document order. When they exceed `maxTokens`, it takes an evenly spaced sample that keeps every chapter represented.

## 7. HTTP and UI
- `POST /api/content` (multipart: `file` plus the metadata fields)
- `GET /api/content?branchId&grade&subjectId`
- `DELETE /api/content/:id`
- `POST /api/content/:id/retry`
- `POST /api/content/exclusions`
- `GET /api/subjects` (school subjects for staff)
- **Pages:**
  - `/school/content`: upload form, list with status badges (queued, processing, ready, failed with retry), and a branch "hide for this branch" toggle.
  - `/teacher/materials`: upload a material for an assigned section and subject, plus a list.
  - Both pages are minimal, mobile-first, and guarded by role.

## 8. Testing
- **Unit tests:**
  - the chunker (boundaries, overlap, no crossing chapters, page ranges)
  - chapter detection, with all three methods on fixture page arrays
  - `FakeEmbedder` determinism and similarity ordering
- **Fixture PDFs** are generated in the test setup with `pdf-lib`, so no binaries are committed:
  - a 30-page text book with an outline of 3 chapters
  - a book with no outline and "Chapter 1/2" headings
  - a book with 3 near-empty pages that triggers OCR through `FakeOcrExtractor`
- **Pipeline integration:** run the job handler directly (no pg-boss) on each fixture and assert the chapters, page ranges, chunk counts, `ready` status, and OCR counts. A forced embedder failure leaves the item `failed`, with no chunks visible.
- **Visibility tests**, table-driven:
  - school item visible
  - branch-excluded item hidden for that branch only
  - branch item visible only in that branch
  - section material visible only to that section
  - wrong grade hidden
  - non-ready item hidden
- **Search:** `searchChunks` with the fake embedder ranks the chunk sharing the query's words first, and respects the subject and chapter filters.
- **Isolation:** extend `tests/isolation` so that every content function, used by a School A actor or scope, never returns or changes School B data, vector search included.

## 9. Out of scope
Non-PDF formats, editing extracted text, versioning books, per-page images and diagrams in answers.
