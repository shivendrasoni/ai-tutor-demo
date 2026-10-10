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
- `OCR_MODEL`: `provider/model` (only `openai/<model>` is supported). Unset means low-text pages keep their text and are counted in `ocr_skipped_pages`, unless mock mode is on (`AI_MOCK=1`, or the keyless `NODE_ENV=development` default; the worker needs `pnpm worker:dev`; see sub-project 3 as-built): then `selectOcr` returns `MockOcrExtractor`, whose text is `[mock OCR] page N: no text layer; OCR is mocked in this environment.` and those pages count in `ocr_pages`. An explicit `OCR_MODEL` always wins. Embeddings are unchanged: `selectEmbedder` falls back to `FakeEmbedder` without `OPENAI_API_KEY` (dev server and worker both use it via `getDeps`); explicit `EMBEDDER` wins.
- `DATABASE_URL_OWNER`: pg-boss connects as the owner because it creates the `pgboss` schema.

## Worker
- Run with `pnpm worker` (`tsx src/worker.ts`; `pnpm worker:dev` sets `NODE_ENV=development` so keyless runs use the mock providers). It loads `.env` through `src/lib/load-env.ts`, which must remain its first import because `@/db/client` builds its pools at import time.
- Queue `ingest`: `policy: 'stately'` (`singletonKey = contentItemId`), `retryLimit: 3`, `retryBackoff: true`, `expireInSeconds: 3600`.
- Queue policy migration (worker only): `startBoss`/`startWorker` call `migrateQueuePolicies` under a Postgres advisory lock. A mismatched queue is dropped and recreated only if it has no created/retry/active job; otherwise an error is logged and the old queue is kept. The web's send-only boss only does idempotent `createQueue` (warns on mismatch, never drops).
- `IngestQueue` has `hasLiveJob(contentItemId)`. `PgBossQueue.enqueue` throws when `send` returns null (stately dedupe) and no created/retry/active job exists for the item, so the caller marks the item failed.
- `retryIngest` also accepts a `queued`/`processing` item with no status change for 15 min (`STUCK_INGEST_AFTER_MS`, measured from `content_items.updated_at`, which is bumped on every status change and re-queue; migration 0014 adds it, backfilled from `created_at`) that has no live job (a lost job); the content list shows Retry for such items using the same `updatedAt` (a re-queued item does not show Retry again for 15 min). A live job is unknowable client-side, so the server may still refuse; the list then shows the server's message. Otherwise it stays VALIDATION.

## Deploy notes: queue policy migration
- Narrow race: the worker counts live jobs, re-counts immediately before `deleteQueue` and skips the drop if the count is non-zero. A web `send` to the old-policy queue in the remaining gap between that last count and `deleteQueue` (milliseconds; pg-boss offers no atomic delete-if-empty) is still lost with the drop. The stuck-item `retryIngest` path recovers ingest items; study jobs have their own recovery paths.
- Old policy plus live jobs: if a queue exists with the old policy and has any created/retry/active job at worker start, the worker keeps the old queue and logs an error. Until you let it drain and restart the worker, the new policy (and so the stately singleton guarantee) does NOT hold: duplicate jobs for one item are possible.
- Runbook: a queue with steady live traffic (any created/retry/active job at worker start) is not migrated and logs an error. Drain it (pause uploads or let jobs finish) and restart the worker. If the migration lock connection drops, the worker's startup fails with the logged error; restart it.

## Requirements and rules
- pgvector 0.8 or later (the search uses `hnsw.iterative_scan`). The docker image is `pgvector/pgvector:pg16`.
- Switching `EMBEDDER` hides existing chunks, because search filters on `embedding_model`. Re-ingest the items to make them searchable again.

## Versions
- AI SDK is `ai@7` (`^7.0.135`); tests mock models with `MockLanguageModelV4`. pg-boss is 12.

## Test helpers
- `tests/helpers/content.ts`: `testBlobs`, `seedItem`, `seedChunks`, `queueItemFor`, `getItemOrNull`, `getItem`
- `tests/helpers/pdfs.ts`: `buildPdf`, `exactText`, `textBook30`, `headingBook`, `scannedBook` (fixtures are generated with `pdf-lib`; no committed binaries)
