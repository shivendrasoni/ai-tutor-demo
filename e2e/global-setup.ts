import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { FakeEmbedder, LocalBlobStore, startWorker } from '@/modules/content';

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

  const blobDir = process.env.BLOB_DIR!;
  await rm(blobDir, { recursive: true, force: true });
  const worker = await startWorker({ blobs: new LocalBlobStore(blobDir), embedder: new FakeEmbedder(), ocr: null });
  return async () => {
    await worker.stop();
  };
}
