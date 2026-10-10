# As-built: sub-project 2 (content and ingestion)

Later plans must use these real names. They take precedence over plan 2's text wherever the two differ.

## Public exports of `src/modules/content/index.ts`
- Service: `MAX_UPLOAD_BYTES`, `uploadContent`, `listContent`, `listUploadTargets`, `retryIngest`, `setExclusion`, `deleteContent`; types `ContentItemRow`, `ContentKind`, `ContentScope`, `IngestStatus`, `UploadInput`, `UploadTargets`
- Ingest and queue: `runIngest`, `INGEST_QUEUE`, `InMemoryQueue`, `startWorker(deps?, extraQueues?)`, `STUCK_INGEST_AFTER_MS`; types `IngestDeps`, `IngestJob`, `IngestQueue`
- Deps: `getDeps` (lazy, per-member memoised: `blobs`, `embedder`, `ocr`, `queue`; destructure only what you need), `setDepsForTest`; type `ContentDeps`
- Adapters: `FakeEmbedder`, `LocalBlobStore`; types `Embedder`, `OcrExtractor`, `BlobStore`
- Student read path: `studentScope`, `visibleContent`, `listVisibleSubjects`, `listVisibleChapters`, `searchChunks`, `chunksForChapters`; types `ChunkHit`, `SearchOpts`, `StudentScope`, `VisibleChapter`, `VisibleItem`
- `ChunkHit.similarity` is exactly 1 for `chunksForChapters` results (no query to compare against).
- Other modules and entrypoints import only from the index, never from `deps`, `queue`, and so on.

## Environment variables
- `BLOB_DIR`: local blob directory (default `.data/blobs`). `S3_BUCKET` and the other `S3_*` variables switch to `S3BlobStore`.
- `EMBEDDER=openai|fake`. Default is `openai` when `OPENAI_API_KEY` is set, otherwise `fake`. `EMBEDDER=openai` without a key throws.
- `OPENAI_API_KEY`: embeddings (`text-embedding-3-small`) and OpenAI OCR models.
- `OCR_MODEL`: `provider/model` (only `openai/<model>` is supported). Unset means low-text pages keep their text and are counted in `ocr_skipped_pages`.
- `DATABASE_URL_OWNER`: pg-boss connects as the owner because it creates the `pgboss` schema.

## Worker
- Run with `pnpm worker` (`tsx src/worker.ts`). It loads `.env` through `src/lib/load-env.ts`, which must remain its first import because `@/db/client` builds its pools at import time.
- Queue `ingest`: `policy: 'stately'` (`singletonKey = contentItemId`), `retryLimit: 3`, `retryBackoff: true`, `expireInSeconds: 3600`.
- Queue policy migration (worker only): `startBoss`/`startWorker` call `migrateQueuePolicies` under a Postgres advisory lock. A mismatched queue is dropped and recreated only if it has no created/retry/active job; otherwise an error is logged and the old queue is kept. The web's send-only boss only does idempotent `createQueue` (warns on mismatch, never drops).
- `IngestQueue` has `hasLiveJob(contentItemId)`. `PgBossQueue.enqueue` throws when `send` returns null (stately dedupe) and no created/retry/active job exists for the item, so the caller marks the item failed.
- `retryIngest` also accepts a `queued`/`processing` item older than 15 min (`STUCK_INGEST_AFTER_MS`, by `created_at`) that has no live job (a lost job); the content list shows Retry for such items. Otherwise it stays VALIDATION.

## Deploy notes: queue policy migration
- Narrow race: the worker counts live jobs and then calls `deleteQueue`; a web `send` to the old-policy queue between those two steps is lost with the drop. The stuck-item `retryIngest` path recovers ingest items; study jobs have their own recovery paths.
- Runbook: a queue with steady live traffic (any created/retry/active job at worker start) is not migrated and logs an error. Drain it (pause uploads or let jobs finish) and restart the worker. If the migration lock connection drops, the worker's startup fails with the logged error; restart it.

## Requirements and rules
- pgvector 0.8 or later (the search uses `hnsw.iterative_scan`). The docker image is `pgvector/pgvector:pg16`.
- Switching `EMBEDDER` hides existing chunks, because search filters on `embedding_model`. Re-ingest the items to make them searchable again.

## Versions
- AI SDK is `ai@7` (`^7.0.135`); tests mock models with `MockLanguageModelV4`. pg-boss is 12.

## Test helpers
- `tests/helpers/content.ts`: `testBlobs`, `seedItem`, `seedChunks`, `queueItemFor`, `getItemOrNull`, `getItem`
- `tests/helpers/pdfs.ts`: `buildPdf`, `exactText`, `textBook30`, `headingBook`, `scannedBook` (fixtures are generated with `pdf-lib`; no committed binaries)
