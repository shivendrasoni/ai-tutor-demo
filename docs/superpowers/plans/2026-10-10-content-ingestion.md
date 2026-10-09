# Content & Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-project 2 of the AI tutor platform. It covers:
- PDF upload by admins and teachers, stored behind a `BlobStore`
- a pg-boss background worker that extracts text, runs OCR on low-text pages, detects chapters, chunks, embeds, and stores the result
- the `Embedder` and `OcrExtractor` seams, each with a fake
- the visibility resolver and the retrieval API other modules use (`searchChunks`, `chunksForChapters`, `listVisibleSubjects`, `listVisibleChapters`, `studentScope`)
- an extension of the isolation suite, HTTP routes, and two minimal pages (`/school/content`, `/teacher/materials`)

**Architecture:** Module `src/modules/content` (③), built on plan 1's `Actor`, `runAs`, `withTenant`, `withPlatform`, and `DomainError`.
- Services take an `Actor` first. Student-facing reads take a `StudentScope`, which only `studentScope(actor)` produces.
- Ingestion is one idempotent job handler, `runIngest`. pg-boss is a thin wrapper around it, so the pipeline is tested without a queue.
- The service layer reaches the queue, blob store, embedder, and OCR extractor through `deps.ts`, so tests inject fakes.
- Chunks and their status flip are written in one transaction, so a partial ingest is never visible.

**Tech Stack:** Plan 1's stack, plus `pg-boss`, `unpdf`, `pdf-lib`, `ai` (Vercel AI SDK v5), `@ai-sdk/openai`, `@aws-sdk/client-s3`.

**Spec:** `docs/superpowers/specs/2026-10-10-content-ingestion-design.md`. It implements §3.2 seams `Embedder` and `OcrExtractor`, §4.2, §6.2, module ③, and the content parts of §8 of the parent spec.

**Depends on sub-project 1 as built** (`docs/superpowers/plans/AS-BUILT-subproject-1.md`, which overrides plan 1's text). It is merged on `main`. Used here: `Actor`, `Tx`, `runAs`, `withTenant`, `withPlatform`, `DomainError`, `canManageSchool`, `canManageBranch`, `assertGrade`, `createBranch`, `createSection`, `createSubject`, `createStaffUser`, `assignTeacher`, `login`, `tenantTables`, `handle`/`requireActor`/`parseWith` in `src/lib/http.ts`, `SESSION_COOKIE = 'sid'`, and `tests/helpers/db.ts` (`resetDb`, `appDbRaw`, `seedTwoSchools`, `SEED_PASSWORD = 'correct-horse'`; seeded users can log in).

**As-built rules this plan follows:**
- New schema files are re-exported from `src/db/schema/index.ts`, and each new `school_id` table is added to `tenantTables`. `tests/db/rls-catalog.test.ts` enforces forced RLS, a policy, and `tenantTables` membership.
- Migrations are applied with `pnpm db:migrate`. Default privileges already grant new tables to `app_user` and `app_admin`, so no per-migration grants are written.
- This plan adds **no new `ErrorCode`**, so the `STATUS` map in `src/lib/http.ts` is unchanged. Upload failures are `VALIDATION` with `details.reason`.
- `readJson` caps bodies at 100 KB (JSON only). Multipart uploads get their own size guard in Task 11.

## Global Constraints

- **Embeddings:** dimension **1536**. `OpenAIEmbedder` = AI SDK `embedMany` with `openai.textEmbeddingModel('text-embedding-3-small')`, needs `OPENAI_API_KEY`. Model ids: `openai:text-embedding-3-small` and `fake:hash-1536`. Column `vector(1536)` with an HNSW index using `vector_cosine_ops`.
- **FakeEmbedder:** deterministic feature hashing. Lowercased word tokens (`/[a-z0-9]+/g`) → 32-bit FNV-1a hash mod 1536, counts, L2-normalised. Similarity is only meaningful for short texts, so test fixtures use short chunks.
- **Embedder selection:** `EMBEDDER=openai|fake`. Default is `openai` if `OPENAI_API_KEY` is set, otherwise `fake`. `EMBEDDER=openai` without a key throws at startup.
- **Embedding batch size:** **96**.
- **Chunking:** token estimate = `ceil(chars / 4)`. Target **600**, hard max **800**, overlap **80** tokens. Chunks never cross a chapter. Split on paragraph breaks, then sentences.
- **OCR:** trigger when page text is shorter than **200 characters** after whitespace collapse (`/\s+/g` → one space, trimmed). 199 triggers; 200 does not. `OCR_MODEL` format is `provider/model`. If it is unset, low-text pages keep their text and `ocr_skipped_pages` counts them.
- **Upload:** PDF only (bytes start with `%PDF-`), max **100 MB** (`100 * 1024 * 1024` bytes). Violations throw `VALIDATION` with `details.reason` = `not_pdf` or `too_large`.
- **Queue:** pg-boss queue `ingest`, payload `{ contentItemId, schoolId }`, `retryLimit: 3`, `retryBackoff: true`. The worker runs via `pnpm worker`.
- **Blob store:** `BLOB_DIR` default `.data/blobs` (`LocalBlobStore`). `S3BlobStore` when `S3_BUCKET` is set. Blob key = `{schoolId}/{contentItemId}.pdf`.
- **Chapter detection, in order:** (1) top-level PDF outline entries that resolve to a page; (2) heading regex `^(chapter|unit|lesson)\s+([0-9]+|[ivxlc]+)\b` (case-insensitive) in the first 3 non-empty lines of a page; (3) fixed 20-page ranges titled `Pages {start}–{end}` (en dash). If method 1 or 2 finds nothing starting on page 1, pages before the first chapter form `Front matter`.
- **Content items:** `kind` `book | material`; `scope` `school | branch | section`; `ingest_status` `queued | processing | ready | failed`. Grade 5–12.
- **Visibility** (parent §4.2, exact): `ready` items with the student's `school_id` and `grade`, and either `scope=school` and not excluded for the student's branch, or `scope=branch` and `branch_id` = student's branch, or `scope=section` and `section_id` = student's section.
- **Retrieval defaults:** `searchChunks` limit **8**, `minSimilarity` **0.25**. Search and chapter reads run inside `withTenant(scope.schoolId)` and filter `content_item_id IN visible`.
- **Isolation:** `content_items`, `content_exclusions`, `content_chapters`, `chunks` get forced RLS with plan 1's exact policy and are added to `tenantTables`. Deleting an item cascades to chapters, chunks, and exclusions, and removes its blob.
- **Tests:** fakes only, no network. No committed binaries. Fixture PDFs come from `pdf-lib` in `tests/helpers/pdfs.ts`.
- **Environment:** every command starts with `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && `.

## Review Focus

1. **Outline entries pointing at wrong or missing pages:** unresolvable (null) pages, two entries on the same page, entries out of page order, and an entry past the last page. Pinned in Task 5.
2. **Re-ingest after a partial failure:** stale chapters/chunks from an earlier run must not duplicate or mix with the new run, and a failed run must leave zero chunks. Pinned in Task 7.
3. **A single paragraph, or a single sentence with no punctuation, longer than 800 tokens:** every chunk must still be ≤ 800 tokens. Pinned in Task 6.
4. **Search with filters that are all invisible** (other school, hidden branch, non-ready): must return `[]`, never fall back to unfiltered search. Pinned in Task 9.
5. **Deleting an item mid-ingest:** the handler must finish without error, with no orphan chunks and no blob left behind. Pinned in Task 7 (and the blob in Task 8).

---

## File Structure

```
docker/init.sql                           (unchanged; the vector extension comes from a migration)
src/db/schema/content.ts                  content_items, content_exclusions, content_chapters, chunks
src/db/schema/index.ts                    (modify) export content tables; add them to tenantTables
src/db/migrations/                        vector_ext (custom, first), generated content tables, content_rls (custom)
src/modules/content/blob.ts               BlobStore, LocalBlobStore, S3BlobStore, selectBlobStore
src/modules/content/embedder.ts           Embedder, FakeEmbedder, OpenAIEmbedder, selectEmbedder, embedInBatches
src/modules/content/ocr.ts                OcrExtractor, FakeOcrExtractor, ModelOcrExtractor, selectOcr
src/modules/content/pdf.ts                extractPdf, splitPage
src/modules/content/chapters.ts           detectChapters
src/modules/content/chunker.ts            estimateTokens, chunkChapter
src/modules/content/ingest.ts             runIngest
src/modules/content/queue.ts              IngestQueue, PgBossQueue, InMemoryQueue, INGEST_QUEUE_OPTIONS
src/modules/content/deps.ts               getDeps, setDepsForTest (blobs, embedder, ocr, queue)
src/modules/content/service.ts            upload/list/delete/retry/exclusions/targets
src/modules/content/visibility.ts         studentScope, visibleContent, listVisible*, searchChunks, chunksForChapters
src/modules/content/index.ts              public exports
src/worker.ts                             pg-boss worker entry (pnpm worker)
src/app/api/content/**, src/app/api/subjects/route.ts
src/app/(staff)/school/content/page.tsx, src/app/(staff)/teacher/materials/page.tsx
src/app/(staff)/_components/{UploadForm,ContentList}.tsx
tests/helpers/pdfs.ts                     buildPdf + fixture books
tests/helpers/content.ts                  seedItem, seedChunks, InMemoryQueue wiring, uploadInput
tests/content/**, tests/isolation/content.test.ts, tests/http/content-routes.test.ts, e2e/content.spec.ts
```

---

### Task 1: Content schema, vector extension, and RLS

**Files:**
- Create: `src/db/schema/content.ts`, three migrations (see Step 1)
- Modify: `src/db/schema/index.ts` (add `export * from './content'`; add the 4 tables to `tenantTables`, making 13), `.env.example`, `.env.test` (`BLOB_DIR`, `EMBEDDER=fake`), `package.json` (deps `pg-boss unpdf pdf-lib ai @ai-sdk/openai @aws-sdk/client-s3`)
- Test: `tests/db/content-rls.test.ts`

**Interfaces:**
- Consumes: plan 1's `seedTwoSchools`, `withTenant`, `withPlatform`, `appDbRaw`, `tenantTables`
- Produces (ids `uuid default gen_random_uuid()`):

```
content_items(id, school_id, grade int check 5..12, subject_id fk, kind text check, scope text check,
  branch_id fk null, section_id fk null, title, file_key text, uploaded_by fk users,
  ingest_status text check default 'queued', ingest_error text null, page_count int null,
  ocr_pages int default 0, ocr_skipped_pages int default 0, size_bytes int, created_at timestamptz default now(),
  check ((scope='school' and branch_id is null and section_id is null)
      or (scope='branch' and branch_id is not null and section_id is null)
      or (scope='section' and branch_id is not null and section_id is not null)))
content_exclusions(school_id, branch_id fk, content_item_id fk cascade; pk(branch_id, content_item_id))
content_chapters(id, school_id, content_item_id fk cascade, ordinal int, title, page_start int, page_end int)
chunks(id, school_id, content_item_id fk cascade, chapter_id fk cascade, ordinal int, page_start int, page_end int,
  text, token_estimate int, embedding vector(1536), embedding_model text, embedding_dim int)
index chunks(school_id, content_item_id); hnsw index on chunks.embedding vector_cosine_ops
```

  - `section` scope requires `branch_id` (an addition to the spec's columns; it makes branch authorization a single lookup).
  - `tenantTables` gains the 4 new tables.

- [ ] **Step 1: Install deps and write the schema.**
  - Run `pnpm db:generate --custom --name vector_ext` first, with body `create extension if not exists vector;`.
  - Write `content.ts` using drizzle's `vector('embedding', { dimensions: 1536 })`.
  - Run `pnpm db:generate`, then `pnpm db:generate --custom --name content_rls`.
  - The RLS migration does, for each of the 4 tables, the same `enable` + `force row level security` and `tenant_isolation` policy as plan 1 (`school_id = nullif(current_setting('app.school_id', true), '')::uuid`, with `with check`).
  - Follow the pattern in `0001_rls.sql`. No grants are needed (`0003_default_privileges.sql`).
  - It also creates the two indexes (HNSW with `using hnsw (embedding vector_cosine_ops)`).
- [ ] **Step 2: Write the failing tests** in `tests/db/content-rls.test.ts`, using `seedTwoSchools` and helper `insertItem(schoolId, …)` (via `withPlatform`):

```ts
it('tenant context sees only its own items, chapters, and chunks', async () => {
  for (const t of [contentItems, contentChapters, chunks])
    expect((await withTenant(seed.a.schoolId, tx => tx.select().from(t))).every(r => r.schoolId === seed.a.schoolId)).toBe(true);
});
it('no tenant context fails closed for all four tables', async () => {
  for (const t of ['content_items','content_exclusions','content_chapters','chunks'])
    expect((await appDbRaw(sql.raw(`select count(*)::int as n from ${t}`))).rows[0].n).toBe(0);
});
it('cannot insert a chunk for another school', async () => {
  await expect(withTenant(seed.a.schoolId, tx => tx.insert(chunks).values({ ...chunkRow, schoolId: seed.b.schoolId })))
    .rejects.toThrow(/row-level security/);
});
it('rejects a 1535-dim embedding', async () => {
  await expect(withPlatform(tx => tx.execute(sql`insert into chunks (..., embedding) values (..., ${vec(1535)}::vector)`))).rejects.toThrow(/dimensions/);
});
it('deleting an item cascades to chapters, chunks, and exclusions', async () => {
  await withPlatform(tx => tx.delete(contentItems).where(eq(contentItems.id, itemId)));
  expect(await countRows(['content_chapters','chunks','content_exclusions'], itemId)).toEqual([0, 0, 0]);
});
it('rejects a school-scope item that carries a branch_id (scope check)', ...);   // check constraint
it('has an HNSW index on chunks.embedding', async () => {
  const r = await withPlatform(tx => tx.execute(sql`select indexdef from pg_indexes where tablename='chunks'`));
  expect(r.rows.some(x => /hnsw.*vector_cosine_ops/.test(x.indexdef))).toBe(true);
});
it('tenantTables includes the four content tables (13 total)', ...);   // rls-catalog.test.ts also enforces this
```

- [ ] **Step 3: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/db/content-rls.test.ts`. Expected: FAIL (tables do not exist).
- [ ] **Step 4: Implement** schema, migrations, and the `tenantTables` extension (Step 1). Check that `tests/setup/global.ts` migrates `tutor_test` with the new migrations (it should, via the same migrator as `pnpm db:migrate`).
- [ ] **Step 5: Run** the same command, then `pnpm vitest run tests/db`. Expected: PASS, including plan 1's `rls.test.ts` and `rls-catalog.test.ts`, which now cover the 4 new tables.
- [ ] **Step 6: Commit:** `git commit -m "feat(db): content schema with pgvector, HNSW index, and forced RLS"`

---

### Task 2: BlobStore

**Files:**
- Create: `src/modules/content/blob.ts`
- Test: `tests/content/blob.test.ts`

**Interfaces:**
- Produces:
  - `interface BlobStore { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array>; delete(key: string): Promise<void> }`
  - `class LocalBlobStore implements BlobStore { constructor(dir: string) }`
  - `class S3BlobStore implements BlobStore { constructor(opts: { bucket: string; client: { send(cmd: unknown): Promise<any> } }) }`
  - `selectBlobStore(env = process.env): BlobStore`: `S3BlobStore` if `S3_BUCKET` is set, otherwise `LocalBlobStore(env.BLOB_DIR ?? '.data/blobs')`.
  - Behavior: `get` of a missing key throws `DomainError('NOT_FOUND')`. `delete` of a missing key is a no-op. Keys containing `..` or starting with `/` throw `VALIDATION`.

- [ ] **Step 1: Write the failing tests** (Local uses `mkdtemp`; S3 uses a fake client recording commands and keeping a `Map`):

```ts
it.each(['local', 's3'])('%s round-trips bytes and deletes', async (kind) => {
  const store = make(kind);
  await store.put('s1/i1.pdf', new Uint8Array([1, 2, 3]));
  expect(Array.from(await store.get('s1/i1.pdf'))).toEqual([1, 2, 3]);
  await store.delete('s1/i1.pdf');
  await expect(store.get('s1/i1.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(store.delete('s1/i1.pdf')).resolves.toBeUndefined();
});
it('rejects path traversal keys', async () => {
  await expect(new LocalBlobStore(dir).put('../x.pdf', new Uint8Array())).rejects.toMatchObject({ code: 'VALIDATION' });
});
it('selects S3 only when S3_BUCKET is set, local default dir otherwise', () => {
  expect(selectBlobStore({ S3_BUCKET: 'b' } as any)).toBeInstanceOf(S3BlobStore);
  expect(selectBlobStore({} as any)).toBeInstanceOf(LocalBlobStore);
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/blob.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `blob.ts`. S3 uses `PutObjectCommand`, `GetObjectCommand` (map `NoSuchKey` to `NOT_FOUND`), and `DeleteObjectCommand`. The real client is built from `S3_BUCKET`, `S3_ENDPOINT`, and `S3_REGION` in `selectBlobStore`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): BlobStore with local and S3 implementations"`

---

### Task 3: Embedder and OcrExtractor seams

**Files:**
- Create: `src/modules/content/embedder.ts`, `src/modules/content/ocr.ts`
- Test: `tests/content/embedder.test.ts`, `tests/content/ocr.test.ts`

**Interfaces:**
- Produces:
  - `interface Embedder { readonly modelId: string; readonly dimension: number; embed(texts: string[]): Promise<number[][]> }`
  - `class FakeEmbedder implements Embedder` (`modelId 'fake:hash-1536'`, `dimension 1536`). Empty or token-less text maps to the unit vector on bucket 0, so cosine is never NaN.
  - `class OpenAIEmbedder implements Embedder` (`modelId 'openai:text-embedding-3-small'`, `dimension 1536`). Uses `embedMany`.
  - `selectEmbedder(env = process.env): Embedder`
  - `embedInBatches(e: Embedder, texts: string[], batchSize = 96): Promise<number[][]>`. Output order matches input order.
  - `interface OcrExtractor { extract(page: { pdf: Uint8Array; pageNumber: number }): Promise<string> }`
  - `class FakeOcrExtractor implements OcrExtractor { constructor(textFor?: (pageNumber: number) => string); calls: number[] }`
  - `class ModelOcrExtractor implements OcrExtractor { constructor(opts: { model: LanguageModel | string }) }`
  - `selectOcr(env = process.env): OcrExtractor | null`: `null` when `OCR_MODEL` is unset.

- [ ] **Step 1: Write the failing tests.**

```ts
// embedder
const e = new FakeEmbedder();
it('is deterministic, 1536-dim, unit length', async () => {
  const [a] = await e.embed(['Plants make food by photosynthesis']);
  expect(a).toEqual((await e.embed(['plants MAKE food, by photosynthesis!']))[0]);   // case/punctuation-insensitive
  expect(a).toHaveLength(1536);
  expect(Math.hypot(...a)).toBeCloseTo(1, 6);
});
it('ranks lexical overlap above unrelated text', async () => {
  const [q, near, far] = await e.embed(['photosynthesis in green plants', 'green plants perform photosynthesis', 'the french revolution began in 1789']);
  expect(cos(q, near)).toBeGreaterThan(0.5);
  expect(cos(q, far)).toBeLessThan(0.1);
});
it('empty text gives a finite unit vector', async () => expect(Math.hypot(...(await e.embed(['']))[0])).toBeCloseTo(1, 6));
it('embedInBatches never exceeds 96 per call and preserves order', async () => {
  const sizes: number[] = [];
  const spy: Embedder = { ...e, modelId: e.modelId, dimension: 1536, embed: async t => { sizes.push(t.length); return e.embed(t); } };
  const out = await embedInBatches(spy, Array.from({ length: 250 }, (_, i) => `word${i}`));
  expect(sizes).toEqual([96, 96, 58]);
  expect(out[200]).toEqual((await e.embed(['word200']))[0]);
});
it('selection: default fake without key, openai with key, explicit openai without key throws', () => {
  expect(selectEmbedder({} as any)).toBeInstanceOf(FakeEmbedder);
  expect(selectEmbedder({ OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(OpenAIEmbedder);
  expect(selectEmbedder({ EMBEDDER: 'fake', OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(FakeEmbedder);
  expect(() => selectEmbedder({ EMBEDDER: 'openai' } as any)).toThrow(/OPENAI_API_KEY/);
});

// ocr (ai/test MockLanguageModelV2)
it('ModelOcrExtractor sends the single-page PDF as a file part and returns the text', async () => {
  const model = new MockLanguageModelV2({ doGenerate: async () => ({ content: [{ type: 'text', text: 'scanned text' }], finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] }) });
  expect(await new ModelOcrExtractor({ model }).extract({ pdf: new Uint8Array([37, 80, 68, 70]), pageNumber: 2 })).toBe('scanned text');
  const part = model.doGenerateCalls[0].prompt.flatMap((m: any) => m.content).find((p: any) => p.type === 'file');
  expect(part.mediaType).toBe('application/pdf');
});
it('FakeOcrExtractor records the pages it was asked for', ...);
it('selectOcr returns null without OCR_MODEL', () => expect(selectOcr({} as any)).toBeNull());
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/embedder.test.ts tests/content/ocr.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ModelOcrExtractor` calls `generateText` with one user message: a text part ("Transcribe all text on this page exactly. Output the text only.") and a `file` part (`data: pdf`, `mediaType: 'application/pdf'`). The `model` string (`provider/model`) is passed through to the AI SDK as-is.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): Embedder and OcrExtractor seams with fakes and model-backed implementations"`

---

### Task 4: PDF fixtures and extraction (unpdf + pdf-lib)

**Files:**
- Create: `src/modules/content/pdf.ts`, `tests/helpers/pdfs.ts`
- Test: `tests/content/pdf.test.ts`

**Interfaces:**
- Produces:
  - `type OutlineEntry = { title: string; page: number | null }` (1-based; `null` if the destination does not resolve to a page)
  - `type ExtractedPdf = { pageCount: number; outline: OutlineEntry[]; pages: string[] }` (`pages[i]` is the text of page `i+1`)
  - `extractPdf(bytes: Uint8Array): Promise<ExtractedPdf>`: top-level outline entries only, in the PDF's order. Page text keeps line breaks, with a blank line where the vertical gap exceeds 1.8× the line height.
  - `splitPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array>`: a one-page PDF via `pdf-lib` `copyPages`.
  - Test helpers (`tests/helpers/pdfs.ts`):
    - `buildPdf(opts: { pages: string[]; outline?: { title: string; page: number | null }[] }): Promise<Uint8Array>`. Draws each line of a page's text with `drawText`, and a blank line for each `\n\n`. Builds `/Outlines` through `pdf-lib`'s low-level context. An outline `page: null` writes an entry with no `/Dest`.
    - `textBook30()`: 30 pages, outline `Chapter 1`/`Chapter 2`/`Chapter 3` at pages 1, 11, 21. Each page has about 1,200 chars of text containing a chapter marker word (`alpha`, `beta`, `gamma`).
    - `headingBook()`: 12 pages, no outline. Page 1 starts `Chapter 1` / `Real Numbers`; page 7 starts `CHAPTER 2` / `Polynomials`.
    - `scannedBook()`: 6 pages. Pages 2, 3, 4 contain only `.`. Pages 1, 5, 6 have about 1,000 chars.

- [ ] **Step 1: Write the failing tests:**

```ts
it('extracts page count, per-page text, and top-level outline', async () => {
  const x = await extractPdf(await textBook30());
  expect(x.pageCount).toBe(30);
  expect(x.pages[0]).toContain('alpha');
  expect(x.pages[10]).toContain('beta');
  expect(x.outline).toEqual([{ title: 'Chapter 1', page: 1 }, { title: 'Chapter 2', page: 11 }, { title: 'Chapter 3', page: 21 }]);
});
it('marks an outline entry with no destination as page null', async () => {
  const x = await extractPdf(await buildPdf({ pages: ['a', 'b'], outline: [{ title: 'Ghost', page: null }, { title: 'B', page: 2 }] }));
  expect(x.outline).toEqual([{ title: 'Ghost', page: null }, { title: 'B', page: 2 }]);
});
it('keeps line breaks so headings are detectable', async () => {
  expect((await extractPdf(await headingBook())).pages[0].split('\n')[0]).toBe('Chapter 1');
});
it('splitPage yields a one-page pdf with that page text', async () => {
  const one = await extractPdf(await splitPage(await textBook30(), 11));
  expect(one.pageCount).toBe(1);
  expect(one.pages[0]).toContain('beta');
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/pdf.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pdf.ts` and the helpers. Approach: `getDocumentProxy(bytes)` from `unpdf`. Per page, `getTextContent()` is joined using `hasEOL` and `transform[5]` y-deltas. For the outline, `pdf.getOutline()`; resolve each `dest` (array or named) with `getDestination` then `getPageIndex(ref)`, catching errors to `null`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): PDF extraction (text, outline) and page splitting with generated fixtures"`

---

### Task 5: Chapter detection

**Files:**
- Create: `src/modules/content/chapters.ts`
- Test: `tests/content/chapters.test.ts`

**Interfaces:**
- Produces:
  - `type ChapterSpan = { ordinal: number; title: string; pageStart: number; pageEnd: number }`
  - `detectChapters(pages: string[], outline: OutlineEntry[]): ChapterSpan[]`. Pure. Spans are contiguous, cover pages `1..pages.length` exactly once, and `ordinal` starts at 0.

- [ ] **Step 1: Write the failing tests** (arrays, no PDFs; `pages = n => Array.from({length:n}, (_, i) => `text ${i+1}`)`):

```ts
it('method 1: outline spans run to the page before the next entry; last runs to the end', () => {
  expect(detectChapters(pages(30), [{title:'Ch A',page:1},{title:'Ch B',page:11},{title:'Ch C',page:21}]))
    .toEqual([{ordinal:0,title:'Ch A',pageStart:1,pageEnd:10},{ordinal:1,title:'Ch B',pageStart:11,pageEnd:20},{ordinal:2,title:'Ch C',pageStart:21,pageEnd:30}]);
});
it('outline starting after page 1 adds Front matter', () => {
  const r = detectChapters(pages(10), [{title:'One',page:3}]);
  expect(r[0]).toEqual({ordinal:0,title:'Front matter',pageStart:1,pageEnd:2});
  expect(r[1]).toMatchObject({title:'One',pageStart:3,pageEnd:10});
});
// REVIEW FOCUS 1
it('ignores unresolved, out-of-range, and duplicate-page outline entries; sorts by page', () => {
  const r = detectChapters(pages(20), [{title:'Ghost',page:null},{title:'B',page:9},{title:'A',page:1},{title:'B dup',page:9},{title:'Beyond',page:99},{title:'Zero',page:0}]);
  expect(r.map(c => [c.title, c.pageStart, c.pageEnd])).toEqual([['A',1,8],['B',9,20]]);
});
it('an outline with no usable entries falls through to the heading heuristic', () => {
  const p = pages(10); p[0] = 'Chapter 1\nReal Numbers\nbody'; p[5] = 'intro line\nUnit IV\nbody';
  expect(detectChapters(p, [{title:'Ghost',page:null}]).map(c => c.title)).toEqual(['Chapter 1 — Real Numbers', 'Unit IV']);
});
it('method 2: heading in the first 3 non-empty lines; title adds next line only if < 80 chars', () => {
  const p = pages(8); p[0] = '\n\nlesson 2\n' + 'x'.repeat(80); p[4] = 'a\nb\nCHAPTER XII\nShort title';
  expect(detectChapters(p, []).map(c => [c.title, c.pageStart])).toEqual([['lesson 2', 1], ['CHAPTER XII — Short title', 5]]);
});
it('a heading on the 4th line or a mid-sentence "chapter 3" is not a chapter', () => {
  const p = pages(5); p[2] = 'a\nb\nc\nChapter 3'; p[3] = 'as we saw in chapter 3 earlier';
  expect(detectChapters(p, []).map(c => c.title)).toEqual(['Pages 1–5']);
});
it('method 2 with first heading on page 4 adds Front matter 1–3', ...);
it('method 3: fixed 20-page ranges', () => {
  expect(detectChapters(pages(45), []).map(c => [c.title, c.pageStart, c.pageEnd]))
    .toEqual([['Pages 1–20',1,20],['Pages 21–40',21,40],['Pages 41–45',41,45]]);
});
it('a single-page document yields one span', () => expect(detectChapters(pages(1), [])).toEqual([{ordinal:0,title:'Pages 1–1',pageStart:1,pageEnd:1}]));
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/chapters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Method 1 keeps entries with `1 <= page <= pages.length`, stable-sorts by page, and keeps the first entry for each page.
  - The heading title is `` `${line} — ${next}` `` (em dash).
  - If method 1 yields no entries, try method 2. If that finds none, use method 3.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): chapter detection from outline, headings, and page ranges"`

---

### Task 6: Chunker

**Files:**
- Create: `src/modules/content/chunker.ts`
- Test: `tests/content/chunker.test.ts`

**Interfaces:**
- Produces:
  - `estimateTokens(text: string): number`: `Math.ceil(text.length / 4)`.
  - `type ChunkDraft = { ordinal: number; text: string; pageStart: number; pageEnd: number; tokenEstimate: number }`
  - `chunkChapter(pages: { page: number; text: string }[], startOrdinal = 0): ChunkDraft[]`. One chapter's pages in order.

**Algorithm decisions** (the tests pin them):
- Units are paragraphs (split on `\n\s*\n`), taken per page. A paragraph never merges across pages, so every unit has exactly one page.
- A unit over 600 tokens is split on sentences (`/(?<=[.!?])\s+/`). A sentence still over 600 tokens is split at the last space before 600 tokens (hard split).
- Units are packed greedily up to 600 tokens.
- Each chunk after the first is prefixed with the last ~80 tokens (320 chars, cut at a word boundary) of the previous chunk. Overlap resets at the chapter start.
- A chunk's `pageStart` and `pageEnd` are the min and max page of all units it contains, including overlap text.
- The maximum is 600 + 80 = 680 ≤ 800.

- [ ] **Step 1: Write the failing tests:**

```ts
const para = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');   // ~n*(len+1) chars
it('short chapter is one chunk with its page range', () => {
  const c = chunkChapter([{ page: 3, text: 'Alpha.\n\nBeta.' }, { page: 4, text: 'Gamma.' }]);
  expect(c).toHaveLength(1);
  expect(c[0]).toMatchObject({ ordinal: 0, pageStart: 3, pageEnd: 4 });
});
it('packs to ~600 tokens, never above 800, overlaps ~80 tokens, ordinals increase', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, text: Array.from({ length: 8 }, (_, j) => `Sentence ${i}-${j} ${para(40)}.`).join(' ') + '\n\n' + 'Tail ' + para(60) + '.' }));
  const c = chunkChapter(pages, 10);
  expect(c.every(x => x.tokenEstimate <= 800)).toBe(true);
  expect(c.map(x => x.ordinal)).toEqual(c.map((_, i) => 10 + i));
  const tail = c[0].text.slice(-300).split(' ').slice(2).join(' ');           // last ~75 tokens of chunk 0
  expect(c[1].text.startsWith(c[0].text.slice(-320).trimStart().split(' ').slice(1).join(' ').slice(0, 40))).toBe(true);
  expect(c[0].pageStart).toBe(1);
  expect(c.at(-1)!.pageEnd).toBe(12);
});
it('page ranges are contiguous and within the chapter pages', () => { /* every chunk pageStart>=first, pageEnd<=last, pageStart<=pageEnd */ });
// REVIEW FOCUS 3
it('a 1,000-token paragraph is split on sentences, all chunks <= 800', () => {
  const text = Array.from({ length: 50 }, (_, i) => `This is sentence number ${i} ${para(12)}.`).join(' ');
  const c = chunkChapter([{ page: 1, text }]);
  expect(estimateTokens(text)).toBeGreaterThan(800);
  expect(c.length).toBeGreaterThan(1);
  expect(c.every(x => x.tokenEstimate <= 800)).toBe(true);
});
it('a 10,000-char run with no punctuation or blank lines is hard-split, all chunks <= 800, no word cut in half', () => {
  const text = para(1500);
  const c = chunkChapter([{ page: 1, text }]);
  expect(c.every(x => x.tokenEstimate <= 800)).toBe(true);
  expect(new Set(c.flatMap(x => x.text.split(' '))).size).toBe(1500);          // nothing lost, nothing truncated
});
it('a 700-token paragraph followed by another paragraph does not merge into one 1,300-token chunk', ...);
it('ignores empty and whitespace-only pages; returns [] for a chapter with no text', () => {
  expect(chunkChapter([{ page: 1, text: '  \n ' }])).toEqual([]);
});
it('does not carry overlap across calls (chapter boundary)', () => {
  const a = chunkChapter([{ page: 1, text: 'ONLYINA ' + para(900) }]);
  const b = chunkChapter([{ page: 2, text: 'ONLYINB ' + para(900) }]);
  expect(b.some(x => x.text.includes('ONLYINA'))).toBe(false);
  expect(a.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/chunker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `chunker.ts` per the decisions above.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): chapter-bounded chunker with overlap and hard-split fallback"`

---

### Task 7: Ingestion job handler, queue, and pg-boss worker

**Files:**
- Create: `src/modules/content/{ingest,queue,deps}.ts`, `src/worker.ts`, `tests/helpers/content.ts`; modify `package.json` (`"worker": "tsx src/worker.ts"`)
- Test: `tests/content/ingest.test.ts`, `tests/content/worker.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6, `withTenant`
- Produces:
  - `type IngestJob = { contentItemId: string; schoolId: string }`
  - `type IngestDeps = { blobs: BlobStore; embedder: Embedder; ocr: OcrExtractor | null }`
  - `runIngest(job: IngestJob, deps: IngestDeps, opts?: { finalAttempt?: boolean }): Promise<void>`. Follows spec §5. On error it records a short `ingest_error` (≤ 300 chars) and rethrows. With `finalAttempt: true` it also sets `failed`. An item that no longer exists (or belongs to a different school than `job.schoolId`) is a successful no-op.
  - `interface IngestQueue { enqueue(job: IngestJob): Promise<void> }`; `class InMemoryQueue implements IngestQueue { jobs: IngestJob[] }`; `class PgBossQueue implements IngestQueue`.
  - `INGEST_QUEUE_OPTIONS = { retryLimit: 3, retryBackoff: true }`. `enqueue` uses `singletonKey = contentItemId`.
  - `getDeps(): { blobs; embedder; ocr; queue }` (env-selected, memoised) and `setDepsForTest(d: Partial<…> | null)`.
  - `startWorker(deps?: IngestDeps): Promise<{ stop(): Promise<void> }>`. It creates the queue with `INGEST_QUEUE_OPTIONS` and calls `boss.work('ingest', { includeMetadata: true }, …)`. Each job runs `runIngest(job.data, deps, { finalAttempt: job.retryCount >= job.retryLimit })`.
  - pg-boss connects with `DATABASE_URL_OWNER`, because it creates the `pgboss` schema (documented in `.env.example`).
  - `tests/helpers/content.ts`: `seedItem(schoolId, overrides): Promise<{ id: string }>` (direct insert via `withPlatform`), `seedChunks(itemId, chapters: {title, texts: string[], pageStart?}[])` (embeds with `FakeEmbedder`), `queueItemFor(seed.a, bytes, overrides)` (puts the blob and inserts a `queued` item, returns the `IngestJob`).

- [ ] **Step 1: Write the failing tests** in `tests/content/ingest.test.ts`, calling `runIngest` directly with `{ blobs: new LocalBlobStore(tmp), embedder: new FakeEmbedder(), ocr: new FakeOcrExtractor(n => 'OCR page ' + n + ' ' + 'ocr body text '.repeat(30)) }`:

```ts
it('text book with outline: 3 chapters, exact page ranges, ready', async () => {
  const job = await queueItemFor(seed.a, await textBook30());
  await runIngest(job, deps);
  const item = await getItem(job);
  expect(item).toMatchObject({ ingestStatus: 'ready', pageCount: 30, ocrPages: 0, ocrSkippedPages: 0, ingestError: null });
  expect((await chaptersOf(job)).map(c => [c.title, c.pageStart, c.pageEnd])).toEqual([['Chapter 1',1,10],['Chapter 2',11,20],['Chapter 3',21,30]]);
  const ch = await chunksOf(job);
  expect(ch.length).toBeGreaterThanOrEqual(3);
  expect(ch.every(c => c.embeddingModel === 'fake:hash-1536' && c.embeddingDim === 1536)).toBe(true);
  expect(ch.every(c => c.pageStart >= c.chapterPageStart && c.pageEnd <= c.chapterPageEnd)).toBe(true);   // never crosses a chapter
});
it('heading book without outline: Chapter 1 / CHAPTER 2 spans 1–6 and 7–12', ...);
it('scanned pages are OCRed: ocr_pages = 3 and their text is replaced by the OCR output', async () => {
  const job = await queueItemFor(seed.a, await scannedBook());
  await runIngest(job, deps);
  expect(await getItem(job)).toMatchObject({ ocrPages: 3, ocrSkippedPages: 0 });
  expect(deps.ocr.calls).toEqual([2, 3, 4]);
  expect((await chunksOf(job)).some(c => c.text.includes('OCR page 3'))).toBe(true);
});
it('without an OCR extractor the low-text pages are skipped and counted, item still ready', async () => {
  await runIngest(job, { ...deps, ocr: null });
  expect(await getItem(job)).toMatchObject({ ingestStatus: 'ready', ocrPages: 0, ocrSkippedPages: 3 });
});
it('a PDF with no extractable text at all fails with a clear error', async () => {
  await runIngest(blankJob, { ...deps, ocr: null }, { finalAttempt: true }).catch(() => {});
  expect(await getItem(blankJob)).toMatchObject({ ingestStatus: 'failed', ingestError: expect.stringMatching(/no extractable text/i) });
});
it('page with exactly 200 chars is not OCRed; 199 is', ...);                        // uses buildPdf pages of 200/199 chars
// failure handling
it('embedder failure on the final attempt: failed, error recorded, zero chunks/chapters', async () => {
  const boom: Embedder = { ...new FakeEmbedder(), modelId: 'x', dimension: 1536, embed: async () => { throw new Error('embedding provider down'); } };
  await expect(runIngest(job, { ...deps, embedder: boom }, { finalAttempt: true })).rejects.toThrow('embedding provider down');
  expect(await getItem(job)).toMatchObject({ ingestStatus: 'failed', ingestError: expect.stringContaining('embedding provider down') });
  expect(await countChunks(job)).toBe(0);
  expect(await countChapters(job)).toBe(0);
});
it('embedder failure on a non-final attempt leaves the item processing (not failed), zero chunks', ...);
// REVIEW FOCUS 2
it('re-ingest after partial failure: stale chapters/chunks are replaced, not duplicated', async () => {
  await seedChunks(job.contentItemId, [{ title: 'STALE', texts: ['stale chunk'] }]);        // simulate leftovers of a crashed run
  await runIngest(job, deps);
  const clean = await freshIngestCounts(textBook30());                                      // same PDF ingested into a second item
  expect(await countChunks(job)).toBe(clean.chunks);
  expect((await chaptersOf(job)).some(c => c.title === 'STALE')).toBe(false);
  await runIngest(job, deps);                                                               // idempotent: a second run gives the same counts
  expect(await countChunks(job)).toBe(clean.chunks);
});
it('fail then retry succeeds and clears ingest_error', async () => {
  await runIngest(job, { ...deps, embedder: boom }, { finalAttempt: true }).catch(() => {});
  await runIngest(job, deps);
  expect(await getItem(job)).toMatchObject({ ingestStatus: 'ready', ingestError: null });
});
it('chunks become visible to other transactions only together with status ready', async () => {
  // embedder hook samples (status, chunk count) from a second connection while embedding: always ('processing', 0)
});
// REVIEW FOCUS 5
it('item deleted while embedding: handler resolves, no orphan chunks or chapters', async () => {
  const slow: Embedder = { ...new FakeEmbedder(), modelId: 'fake:hash-1536', dimension: 1536,
    embed: async t => { await withPlatform(tx => tx.delete(contentItems).where(eq(contentItems.id, job.contentItemId))); return new FakeEmbedder().embed(t); } };
  await expect(runIngest(job, { ...deps, embedder: slow })).resolves.toBeUndefined();
  expect(await withPlatform(tx => tx.select().from(chunks))).toHaveLength(0);
});
it('item already deleted before the job runs, or schoolId mismatch, is a no-op', async () => {
  await expect(runIngest({ ...job, schoolId: seed.b.schoolId }, deps)).resolves.toBeUndefined();
  expect((await getItem(job)).ingestStatus).toBe('queued');                                // untouched
});
```

  `tests/content/worker.test.ts`:

```ts
it('queue options are retryLimit 3 with backoff', () => expect(INGEST_QUEUE_OPTIONS).toEqual({ retryLimit: 3, retryBackoff: true }));
it('worker picks up an enqueued job and the item becomes ready (real pg-boss on the test DB, fakes for AI)', async () => {
  const w = await startWorker(deps); const q = new PgBossQueue();
  await q.enqueue(job);
  await waitFor(async () => (await getItem(job)).ingestStatus === 'ready', 15_000);
  await w.stop();
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/ingest.test.ts tests/content/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Pipeline order:** step 1 (own tx via `withTenant`) sets `processing` and clears the error, deleting old chapters and chunks. Steps 2–5 run outside any transaction.
  - **Final write:** step 6–7 is one `withTenant` tx that begins with `select id from content_items where id = $1 for update`. If no row, it returns silently. Otherwise it inserts chapters, then chunks in batches of 50, then sets `ready`, `page_count`, `ocr_pages`, and `ocr_skipped_pages`.
  - **OCR counting:** a low-text page with an extractor increments `ocr_pages`. Without one it increments `ocr_skipped_pages`.
  - **Zero chunks:** throws `Error('No extractable text')`.
  - **Failure handler:** a `catch` around the pipeline updates `ingest_error` (and `failed` if `finalAttempt`) scoped by `id` and `school_id`, then rethrows.
  - **Worker:** `src/worker.ts` loads env, calls `startWorker(getDeps())`, and stops on `SIGTERM`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): idempotent ingestion pipeline with pg-boss worker"`

---

### Task 8: Content service (upload, list, delete, retry, exclusions, targets)

**Files:**
- Create: `src/modules/content/service.ts`, `src/modules/content/index.ts` (initial exports)
- Modify: `src/modules/tenancy/service.ts` and `src/modules/tenancy/index.ts` (add `listSubjects`; it does not exist yet)
- Test: `tests/content/service.test.ts`

**Interfaces:**
- Consumes: `runAs`, `canManageSchool`, `canManageBranch`, `assertGrade`, `getDeps`, `selectBlobStore` via deps, `DomainError`
- Produces (signatures as spec §6, with these types):
  - `type ContentItemRow = { id; schoolId; scope; kind; grade; subjectId; subjectName; branchId: string | null; sectionId: string | null; title; status: IngestStatus; ingestError: string | null; pageCount: number | null; ocrPages: number; ocrSkippedPages: number; sizeBytes: number; uploadedBy: string; createdAt: Date; excludedBranchIds: string[] }`
  - `uploadContent(actor, input): Promise<{ id: string }>` (input exactly as spec §6)
  - `listContent(actor, filter: { branchId?: string; grade?: number; subjectId?: string }): Promise<ContentItemRow[]>`
  - `deleteContent(actor, itemId): Promise<void>`
  - `retryIngest(actor, itemId): Promise<void>`
  - `setExclusion(actor, { branchId, contentItemId, excluded }): Promise<void>`
  - `listUploadTargets(actor): Promise<{ branches: {id,name}[]; sections: {id,branchId,grade,name}[]; subjects: {id,name}[]; assignments: {sectionId,subjectId}[] }>`: only what that actor may upload to (a teacher gets only assigned sections and subjects).
  - `MAX_UPLOAD_BYTES = 100 * 1024 * 1024`
  - tenancy: `listSubjects(actor): Promise<{ id: string; name: string }[]>`: staff of that school (a platform admin gets all subjects); a student gets `FORBIDDEN`.

**Authorization rules:**
- Non-platform `input.schoolId` must equal `actor.schoolId`, else `FORBIDDEN`.
- `scope=school`: `canManageSchool`.
- `scope=branch`: `canManageBranch(schoolId, branchId)`.
- `scope=section`: `canManageBranch` of the section's branch, **or** a `teacher` with a `teacher_assignments` row for that section and subject.
- A teacher may only upload `kind=material` with `scope=section`.
- Students and unassigned staff get `FORBIDDEN`.
- `deleteContent` and `retryIngest` apply the same rule to the item's own scope, branch, section, and subject. A missing or other-school item gives `NOT_FOUND`.
- Item fields are validated before the authorization check is evaluated (grade 5–12, subject in school, branch in school, section in branch with `section.grade === input.grade`), all `VALIDATION`.

- [ ] **Step 1: Write the failing tests.** Setup: `setDepsForTest({ blobs: new LocalBlobStore(tmp), queue: new InMemoryQueue() })`. `up(actor, over)` calls `uploadContent` with a valid base input (`textBook30` bytes small enough via a 2-page PDF).

```ts
it('upload stores the blob, creates a queued item, and enqueues exactly one job', async () => {
  const { id } = await up(seed.a.schoolAdmin, { scope: 'school', kind: 'book' });
  expect(await getItem(id)).toMatchObject({ ingestStatus: 'queued', sizeBytes: bytes.length, fileKey: `${seed.a.schoolId}/${id}.pdf`, uploadedBy: seed.a.schoolAdmin.userId });
  expect((await blobs.get(`${seed.a.schoolId}/${id}.pdf`)).length).toBe(bytes.length);
  expect(queue.jobs).toEqual([{ contentItemId: id, schoolId: seed.a.schoolId }]);
});
it.each([
  ['school_admin', 'a.schoolAdmin', { scope: 'school', kind: 'book' }, true],
  ['branch_admin school scope', 'a.branchAdmin', { scope: 'school', kind: 'book' }, false],
  ['branch_admin branch scope', 'a.branchAdmin', { scope: 'branch', kind: 'book' }, true],
  ['branch_admin section scope', 'a.branchAdmin', { scope: 'section', kind: 'material' }, true],
  ['teacher unassigned', 'a.teacher', { scope: 'section', kind: 'material' }, false],
  ['teacher book at section', 'a.teacher*', { scope: 'section', kind: 'book' }, false],
  ['teacher branch material', 'a.teacher*', { scope: 'branch', kind: 'material' }, false],
  ['teacher assigned section material', 'a.teacher*', { scope: 'section', kind: 'material' }, true],
  ['teacher assigned to other subject', 'a.teacher**', { scope: 'section', kind: 'material' }, false],
  ['student', 'a.student', { scope: 'section', kind: 'material' }, false],
  ['school_admin B into school A', 'b.schoolAdmin', { scope: 'school', kind: 'book' }, false],
])('authz: %s', ...);          // * = after assignTeacher(section, subject); ** = assigned only to a second subject
it('platform admin can upload when schoolId is given', ...);
it.each([[4],[13]])('grade %i is VALIDATION', ...);
it('subject from another school, section in another branch, and section grade mismatch are VALIDATION', ...);
it('rejects non-PDF bytes and >100 MB', async () => {
  await expect(up(seed.a.schoolAdmin, { file: { bytes: new TextEncoder().encode('%PDX-1.4'), filename: 'a.pdf' } }))
    .rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'not_pdf' } });
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set(new TextEncoder().encode('%PDF-'));
  await expect(up(seed.a.schoolAdmin, { file: { bytes: big, filename: 'a.pdf' } })).rejects.toMatchObject({ details: { reason: 'too_large' } });
  expect(queue.jobs).toHaveLength(0);                                    // nothing stored or queued on rejection
});
it('if enqueue fails the item is marked failed with an error and the call rejects', ...);
it('delete removes the row (cascading) and the blob; queued job for it later no-ops', async () => {
  await deleteContent(seed.a.schoolAdmin, id);
  expect(await getItemOrNull(id)).toBeNull();
  await expect(blobs.get(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(runIngest(job, deps)).resolves.toBeUndefined();
});
it('delete while processing leaves no blob and no chunks', ...);           // item set to processing first; REVIEW FOCUS 5 (blob side)
it('delete authz mirrors upload; other-school item is NOT_FOUND', ...);
it('retry only from failed: sets queued, clears error, enqueues; other statuses are VALIDATION', ...);
it('exclusions: branch_admin can hide a school item for own branch, idempotently; unhide removes the row', ...);
it('exclusion rejects branch/section-scope items (VALIDATION) and other branches (FORBIDDEN)', ...);
it('listContent: school_admin sees all; branch_admin sees school items plus own-branch items; teacher sees own uploads plus school/branch items for assigned grades only; student FORBIDDEN', ...);
it('listContent filters by branchId, grade, subjectId and reports excludedBranchIds', ...);
it('listUploadTargets for a teacher returns only assigned sections and subjects', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/service.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Upload order:** file checks, then school/field validation, then authz, then `crypto.randomUUID()` for the id. Put the blob, insert the `queued` item under `runAs`, then enqueue.
  - **Enqueue failure:** compensate by marking the item `failed` with `ingest_error = 'Could not queue job'`.
  - **Delete:** delete the row first, then the blob. A blob error is logged, not thrown.
  - **Exclusions:** `setExclusion` inserts with `on conflict do nothing`, or deletes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): upload, list, delete, retry, and exclusion services with authorization"`

---

### Task 9: Visibility, search, and chapter retrieval

**Files:**
- Create: `src/modules/content/visibility.ts`; modify `src/modules/content/index.ts`
- Test: `tests/content/visibility.test.ts`, `tests/content/search.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `getDeps().embedder`, `seedItem`, `seedChunks`
- Produces (types as spec §6):
  - `type StudentScope = { schoolId: string; branchId: string; sectionId: string | null; grade: number }`
  - `type VisibleItem = { id: string; title: string; kind: 'book' | 'material'; scope: 'school' | 'branch' | 'section'; subjectId: string; subjectName: string; grade: number }`
  - `type ChunkHit = { chunkId; contentItemId; itemTitle; subjectId; subjectName; chapterId; chapterTitle; pageStart: number; pageEnd: number; text; similarity: number }`
  - `studentScope(actor): Promise<StudentScope>`: `FORBIDDEN` unless the actor has role `student` and its profile status is `active`.
  - `visibleContent(scope): Promise<VisibleItem[]>`
  - `listVisibleSubjects(scope)`, `listVisibleChapters(scope, subjectId)`
  - `searchChunks(scope, query, opts?)`, `chunksForChapters(scope, chapterIds, maxTokens)`

**Semantics decided here:**
- `subjectIds` or `chapterIds` that are `undefined` or `[]` mean "no filter".
- A non-empty list is intersected with what is visible. If the intersection is empty the result is `[]`, never an unfiltered search.
- `searchChunks` only returns chunks whose `embedding_model` equals the current embedder's `modelId`.
- `listVisibleChapters` returns only chapters that have at least one chunk, ordered by item then ordinal.
- `chunksForChapters` returns chunks grouped in the order of the given `chapterIds` (invisible ids dropped), each in chunk ordinal order.
- When the total exceeds `maxTokens`, it first reserves one chunk per chapter (the evenly spaced middle one), then adds chunks round-robin to the chapter with the lowest sampled/total ratio, choosing evenly spaced indices, until the next chunk would exceed `maxTokens`.

- [ ] **Step 1: Write the failing tests.**

`visibility.test.ts` (table-driven; the student is grade 8, branch A1, section 8-A. `seedItem` sets `status` and scope. A second branch `A2` is created with `createBranch`, and its scope is a hand-built `StudentScope`):

```ts
it.each([
  ['school item', { scope: 'school' }, true],
  ['school item excluded for this branch', { scope: 'school', excludeFor: 'A1' }, false],
  ['school item excluded for another branch only', { scope: 'school', excludeFor: 'A2' }, true],
  ['branch item in own branch', { scope: 'branch', branch: 'A1' }, true],
  ['branch item in another branch', { scope: 'branch', branch: 'A2' }, false],
  ['section item for own section', { scope: 'section', section: '8-A' }, true],
  ['section item for another section', { scope: 'section', section: 'other' }, false],
  ['wrong grade', { scope: 'school', grade: 9 }, false],
  ['queued', { scope: 'school', status: 'queued' }, false],
  ['processing', { scope: 'school', status: 'processing' }, false],
  ['failed', { scope: 'school', status: 'failed' }, false],
  ['other school, same grade', { scope: 'school', school: 'B' }, false],
])('%s', async (_n, spec, expected) => { /* seed, then expect(ids(await visibleContent(scopeA1))).includes(id) === expected */ });
it('branch swap: school book excluded + branch replacement shows only the replacement', ...);
it('a student with no section sees no section-scope material', ...);
it('studentScope: active student ok; pending, lapsed, removed, teacher, school_admin are FORBIDDEN', ...);
it('listVisibleSubjects lists only subjects with a visible item; listVisibleChapters only chapters with chunks', ...);
```

`search.test.ts` (chunks seeded as short texts so fake-embedder cosine is meaningful):

```ts
const c = (t: string) => t;
beforeEach(async () => { await seedChunks(bookMath.id, [{ title: 'Ch Algebra', texts: ['quadratic equations have two roots found by the quadratic formula', 'linear equations graph as straight lines'] }]);
                         await seedChunks(bookSci.id,  [{ title: 'Ch Plants',  texts: ['photosynthesis converts sunlight water and carbon dioxide into glucose'] }]); });
it('ranks the chunk sharing the query words first with full ChunkHit fields', async () => {
  const hits = await searchChunks(scope, 'how are quadratic equations solved by the quadratic formula');
  expect(hits[0]).toMatchObject({ itemTitle: 'Math book', subjectName: 'Math', chapterTitle: 'Ch Algebra', pageStart: expect.any(Number), pageEnd: expect.any(Number) });
  expect(hits[0].text).toContain('quadratic formula');
  expect(hits[0].similarity).toBeGreaterThan(0.25);
  expect(hits.map(h => h.similarity)).toEqual([...hits.map(h => h.similarity)].sort((a, b) => b - a));
});
it('applies minSimilarity (default 0.25) and limit (default 8)', ...);          // unrelated query → []; 12 matching chunks → 8; opts.limit 3 → 3; opts.minSimilarity 0 returns weak hits
it('subject and chapter filters narrow results', async () => {
  expect((await searchChunks(scope, 'photosynthesis glucose', { subjectIds: [mathSubject] }))).toEqual([]);
  expect((await searchChunks(scope, 'photosynthesis glucose', { chapterIds: [plantsChapter] }))[0].chapterTitle).toBe('Ch Plants');
});
// REVIEW FOCUS 4
it('filters that are all invisible return [] and never fall back to an unfiltered search', async () => {
  for (const opts of [{ subjectIds: [seed.b.subjectId] }, { chapterIds: [bChapterId] }, { chapterIds: [excludedChapterId] }, { chapterIds: [queuedItemChapterId] }, { subjectIds: [seed.b.subjectId], chapterIds: [plantsChapter] }])
    expect(await searchChunks(scope, 'photosynthesis glucose sunlight', opts)).toEqual([]);
});
it('a mix of visible and invisible ids silently drops the invisible ones', ...);
it('empty arrays mean no filter', ...);
it('never returns chunks of hidden, excluded, wrong-grade, or non-ready items even if their text matches best', ...);
it('ignores chunks embedded with a different embedding_model', ...);
it('chunksForChapters: document order; all chunks when within maxTokens', ...);
it('chunksForChapters samples evenly, keeps every chapter, respects maxTokens', async () => {
  // chapters with 10, 2, 1 chunks of 500 tokens each; maxTokens 2000
  const r = await chunksForChapters(scope, [c1, c2, c3], 2000);
  expect(new Set(r.map(h => h.chapterId))).toEqual(new Set([c1, c2, c3]));
  expect(sum(r.map(tokens))).toBeLessThanOrEqual(2000);
  expect(r.map(h => h.chapterId)).toEqual([...r.map(h => h.chapterId)].sort(byGivenOrder));   // document order
});
it('chunksForChapters drops invisible chapter ids, and returns [] if none are visible', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/content/visibility.test.ts tests/content/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - One shared SQL fragment `visibleItemIds(scope)` implements the parent §4.2 rule.
  - **`searchChunks`:** embeds the query once. Runs `select … , 1 - (embedding <=> $q::vector) as similarity from chunks join content_chapters join content_items join subjects where content_item_id in (visible) and embedding_model = $m [and subject/chapter filters] order by embedding <=> $q::vector limit $n`, then drops hits below `minSimilarity`. The limit is clamped to 1–50.
  - **Filter intersection:** done in SQL against the visible set. If the supplied list is non-empty and the intersection is empty, return `[]` without querying chunks.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(content): visibility resolver, scoped vector search, and chapter chunk retrieval"`

---

### Task 10: Isolation suite extension

**Files:**
- Create: `tests/isolation/content.test.ts`
- Test: same file

**Interfaces:**
- Consumes: every public function in `src/modules/content/index.ts`, `seedTwoSchools`, `seedItem`, `seedChunks`, `tenantTables`

- [ ] **Step 1: Write the isolation tests.** Setup seeds, for each school, a `ready` item with two chapters and chunks via `seedChunks`, using identical texts in A and B (for example `'shared phrase about photosynthesis glucose'`) so that a leak would be visible. Each case acts as School A against School B ids:

```ts
it('raw RLS: content tables return only own-school rows (loop over tenantTables, content tables included)', async () => {
  for (const t of tenantTables) expect((await withTenant(seed.a.schoolId, tx => tx.select().from(t))).every(r => (r.schoolId ?? r.id) === seed.a.schoolId)).toBe(true);
});
it('searchChunks as A never returns B chunks, even for B-only text and with B filters', async () => {
  const hits = await searchChunks(scopeA, 'shared phrase about photosynthesis glucose');
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every(h => aChunkIds.has(h.chunkId))).toBe(true);
  expect(await searchChunks(scopeA, 'b only secret words', { subjectIds: [seed.b.subjectId], chapterIds: [bChapter] })).toEqual([]);
});
it('a forged scope (A schoolId with B branchId/sectionId) sees no B items or chunks', async () => {
  const forged = { schoolId: seed.a.schoolId, branchId: seed.b.branchId, sectionId: seed.b.sectionId, grade: 8 };
  expect((await visibleContent(forged)).every(i => aItemIds.has(i.id))).toBe(true);
  expect((await searchChunks(forged, 'shared phrase')).every(h => aChunkIds.has(h.chunkId))).toBe(true);
});
it('chunksForChapters / listVisibleChapters / listVisibleSubjects with B ids return nothing of B', ...);
it('deleteContent, retryIngest on a B item as A school_admin: NOT_FOUND, B item untouched', ...);   // verified with withPlatform
it('setExclusion for a B branch/item as A school_admin rejects; no exclusion row created', ...);
it('uploadContent with B schoolId / B subject / B section as A school_admin rejects; no B rows, no blob, no job', ...);
it('listContent as A school_admin returns no B items, even filtered by B branchId or subjectId', ...);
it('studentScope(a.student) is school A; studentScope(b.student) is school B', ...);
it('a pg-boss job with School A id and a B item id is a no-op', async () => { /* runIngest({contentItemId: bItem, schoolId: A}) leaves B item status unchanged */ });
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/isolation`. Expected: PASS if Tasks 1–9 are correct (plan 1's cases still pass). Any failure is a real leak; fix it in the owning module before continuing.
- [ ] **Step 3: Confirm CI.** `.github/workflows/ci.yml` already runs `pnpm vitest run`, so no change is needed. Check that `pnpm test:isolation` picks up the new file.
- [ ] **Step 4: Run the whole suite:** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run && pnpm tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "test: extend cross-school isolation suite to content, chunks, and vector search"`

---

### Task 11: HTTP routes, pages, and end-to-end

**Files:**
- Create:
  - `src/lib/multipart.ts`
  - `src/app/api/content/route.ts` (GET, POST), `src/app/api/content/[id]/route.ts` (DELETE), `src/app/api/content/[id]/retry/route.ts`, `src/app/api/content/exclusions/route.ts`, `src/app/api/subjects/route.ts`
  - `src/app/(staff)/school/content/page.tsx`, `src/app/(staff)/teacher/materials/page.tsx`, `src/app/(staff)/_components/UploadForm.tsx`, `src/app/(staff)/_components/ContentList.tsx`
  - `e2e/content.spec.ts`
- Modify: `e2e/global-setup.ts` (clear `BLOB_DIR`, call `startWorker({ blobs, embedder: new FakeEmbedder(), ocr: null })` in-process, and return a teardown that stops it), `playwright.config.ts` (add `EMBEDDER: 'fake'` and `BLOB_DIR` to `serverEnv`, so the web server and worker share one blob dir)
- Test: `tests/http/content-routes.test.ts`, `e2e/content.spec.ts`

**Interfaces:**
- Consumes: plan 1's `handle`, `requireActor`; Task 8 services; `listSubjects`
- Produces:
  - `POST /api/content`: multipart with `file` plus `scope, schoolId?, branchId?, sectionId?, grade, subjectId, kind, title`. Returns 201 `{ id }`. `schoolId` defaults to the actor's.
  - `GET /api/content?branchId&grade&subjectId` → `ContentItemRow[]`
  - `DELETE /api/content/:id` → 200 `{}`
  - `POST /api/content/:id/retry` → 200 `{}`
  - `POST /api/content/exclusions { branchId, contentItemId, excluded }` → 200 `{}`
  - `GET /api/subjects` → `{ id, name }[]`
  - Error mapping is unchanged (`VALIDATION` 400, `NOT_FOUND` 404, `FORBIDDEN` 403).
  - `src/lib/multipart.ts`: `readUpload(req: Request): Promise<FormData>`. It rejects with `VALIDATION` (`details.reason = 'too_large'`) when `content-length` is missing or exceeds `MAX_UPLOAD_BYTES + 1 MiB`, and with `VALIDATION` when the content type is not `multipart/form-data`. This keeps the 100 KB `readJson` cap untouched.
  - **Pages:** server components read the actor and call `listContent` and `listUploadTargets`, then pass the data as props. Role guard: no actor → redirect `/login`. `/school/content` requires `school_admin`, `branch_admin`, or platform admin. `/teacher/materials` requires `teacher`. Any other role gets a "Not allowed" page (403).
  - `UploadForm` is mobile-first, one column. It has title, kind, scope, branch, section, grade, subject, and file inputs, built from the targets. For teachers, kind and scope are fixed to `material` and `section`.
  - `ContentList` shows status badges with the exact texts `Queued`, `Processing`, `Ready`, `Failed`. `Failed` shows the error text and a `Retry` button. It also shows an `OCR skipped on N pages` note when `ocrSkippedPages > 0`. School-scope items show a `Hide for this branch` / `Show for this branch` toggle for branch admins. The list polls `GET /api/content` every 3 s while any item is `queued` or `processing`.

- [ ] **Step 1: Write the failing route tests** (import handlers, call with `new Request`, cookie from `login`; `setDepsForTest` with local blobs and `InMemoryQueue`):

```ts
it('401 without a session on every content endpoint', ...);
it('school admin uploads a multipart PDF → 201 {id}; item is queued and appears in GET /api/content', async () => {
  const fd = new FormData(); fd.set('file', new File([bytes], 'book.pdf', { type: 'application/pdf' }));
  for (const [k, v] of Object.entries({ scope: 'school', grade: '8', subjectId: seed.a.subjectId, kind: 'book', title: 'Maths 8' })) fd.set(k, v);
  const res = await POST(req('/api/content', { method: 'POST', body: fd, cookie }));
  expect(res.status).toBe(201);
  const list = await (await GET(req('/api/content?grade=8', { cookie }))).json();
  expect(list[0]).toMatchObject({ title: 'Maths 8', status: 'queued' });
});
it('non-PDF upload → 400 VALIDATION with details.reason not_pdf', ...);
it('multipart with content-length over 101 MiB → 400 too_large before the body is read; a JSON body is not accepted on POST /api/content', ...);
it('student → 403 on upload/list/subjects; assigned teacher can upload a section material; unassigned teacher 403', ...);
it('DELETE of another school’s item → 404', ...);
it('retry on a non-failed item → 400; on a failed item → 200 and status queued', ...);
it('POST /api/content/exclusions toggles hide/unhide for a branch_admin; GET shows excludedBranchIds', ...);
it('GET /api/subjects lists the school’s subjects for staff only', ...);
```

- [ ] **Step 2: Write the failing e2e** `e2e/content.spec.ts` (mobile viewport 390×844). `beforeAll` seeds a school, branch, grade-8 section, a subject, a school admin, and a teacher assigned to that section and subject (via module functions). The worker runs in-process from `global-setup.ts` with fakes, and the web server uses `EMBEDDER=fake`. Fixture PDF is written to a temp file from `buildPdf`:
  1. Log in as the school admin and open `/school/content`. Upload a school-scope book titled `E2E Book`. Expect a `Queued` or `Processing` badge, then `Ready` within 30 s (worker running).
  2. Upload a non-PDF file. Expect an inline error and no new list row.
  3. Toggle `Hide for this branch` as a branch admin and expect the label to change to `Show for this branch`.
  4. Log in as the teacher and open `/teacher/materials`. Upload a material for the assigned section. Expect `Ready`. Visit `/school/content` as the teacher and expect `Not allowed`.
  5. Log out, then open `/school/content` and expect a redirect to `/login`.
- [ ] **Step 3: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/http/content-routes.test.ts`. Expected: FAIL. Then run `pnpm e2e e2e/content.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the routes (parse the multipart body with `req.formData()`, coerce `grade` with zod) and the pages and components.
- [ ] **Step 5: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run && pnpm e2e && pnpm tsc --noEmit`. Expected: all PASS.
- [ ] **Step 6: Commit:** `git commit -m "feat(content): content API routes and school/teacher upload pages with e2e ingest flow"`
