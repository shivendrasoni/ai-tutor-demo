import { selectBlobStore } from './blob';
import { selectEmbedder } from './embedder';
import type { IngestDeps } from './ingest';
import { selectOcr } from './ocr';
import { PgBossQueue, type IngestQueue } from './queue';

export type ContentDeps = IngestDeps & { queue: IngestQueue };

let cached: ContentDeps | null = null;
let override: Partial<ContentDeps> | null = null;

export function getDeps(): ContentDeps {
  cached ??= {
    blobs: selectBlobStore(),
    embedder: selectEmbedder(),
    ocr: selectOcr(),
    queue: new PgBossQueue(),
  };
  return { ...cached, ...override };
}

export function setDepsForTest(d: Partial<ContentDeps> | null): void {
  override = d;
}
