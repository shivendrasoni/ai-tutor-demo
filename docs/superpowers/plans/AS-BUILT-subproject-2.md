# As-built: sub-project 2 (content and ingestion)

Later plans must use these real names. They take precedence over plan 2's text wherever the two differ.

## Public exports of `src/modules/content/index.ts`
- Service: `MAX_UPLOAD_BYTES`, `uploadContent`, `listContent`, `listUploadTargets`, `retryIngest`, `setExclusion`, `deleteContent`; types `ContentItemRow`, `ContentKind`, `ContentScope`, `IngestStatus`, `UploadInput`, `UploadTargets`
- Ingest and queue: `runIngest`, `INGEST_QUEUE`, `InMemoryQueue`, `startWorker`; types `IngestDeps`, `IngestJob`, `IngestQueue`
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
- Queue `ingest`: `retryLimit: 3`, `retryBackoff: true`, `expireInSeconds: 3600`.

## Requirements and rules
- pgvector 0.8 or later (the search uses `hnsw.iterative_scan`). The docker image is `pgvector/pgvector:pg16`.
- Switching `EMBEDDER` hides existing chunks, because search filters on `embedding_model`. Re-ingest the items to make them searchable again.

## Versions
- AI SDK is `ai@7` (`^7.0.135`); tests mock models with `MockLanguageModelV4`. pg-boss is 12.

## Test helpers
- `tests/helpers/content.ts`: `testBlobs`, `seedItem`, `seedChunks`, `queueItemFor`, `getItemOrNull`, `getItem`
- `tests/helpers/pdfs.ts`: `buildPdf`, `exactText`, `textBook30`, `headingBook`, `scannedBook` (fixtures are generated with `pdf-lib`; no committed binaries)
