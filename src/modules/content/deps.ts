import { selectBlobStore } from './blob';
import { selectEmbedder } from './embedder';
import type { IngestDeps } from './ingest';
import { selectOcr } from './ocr';
import { PgBossQueue, type IngestQueue } from './queue';

export type ContentDeps = IngestDeps & { queue: IngestQueue };

const factories: { [K in keyof ContentDeps]: () => ContentDeps[K] } = {
  blobs: selectBlobStore,
  embedder: selectEmbedder,
  ocr: selectOcr,
  queue: () => new PgBossQueue(),
};

let cached: Partial<ContentDeps> = {};
let override: Partial<ContentDeps> | null = null;

function resolve<K extends keyof ContentDeps>(key: K): ContentDeps[K] {
  if (override && key in override) return override[key] as ContentDeps[K];
  if (!(key in cached)) cached[key] = factories[key]();
  return cached[key] as ContentDeps[K];
}

/**
 * Each dependency is built on first access, so a caller only pays for (and can only be broken by) the
 * members it uses: search needs just the embedder, so a bad OCR_MODEL or S3 config cannot break it.
 * Destructure only what you need; do not spread the result.
 */
export function getDeps(): ContentDeps {
  return {
    get blobs() {
      return resolve('blobs');
    },
    get embedder() {
      return resolve('embedder');
    },
    get ocr() {
      return resolve('ocr');
    },
    get queue() {
      return resolve('queue');
    },
  };
}

export function setDepsForTest(d: Partial<ContentDeps> | null): void {
  override = d;
  if (d === null) cached = {};
}
