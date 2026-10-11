import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { FakeEmbedder, getDeps, LocalBlobStore, startWorker } from '@/modules/content';
import { registerStudyToolsWorkers, STUDY_QUEUE_SPECS } from '@/modules/studytools';

/**
 * Applies migrations to the test database (env loaded from .env.test by playwright.config.ts), clears the
 * shared blob dir, and runs the ingest worker in-process with fakes. The Next server uploads to the same
 * BLOB_DIR and enqueues through pg-boss, so uploads made in a spec are ingested here.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
  } finally {
    await pool.end();
  }

  const real = process.env.E2E_REAL === '1';
  process.env.AI_MOCK = real ? '0' : '1'; // playwright.config.ts sets it too; keeps this worker in mock mode if run standalone
  const blobDir = process.env.BLOB_DIR!;
  await rm(blobDir, { recursive: true, force: true });
  // Same wiring as src/worker.ts: study generate/grade jobs run in-process too. Real runs index with the real embedder,
  // so the chunks match the query embeddings the server uses.
  const deps = real ? getDeps() : { blobs: new LocalBlobStore(blobDir), embedder: new FakeEmbedder(), ocr: null };
  const worker = await startWorker(deps, STUDY_QUEUE_SPECS);
  await registerStudyToolsWorkers(worker.boss);
  return async () => {
    await worker.stop();
  };
}
