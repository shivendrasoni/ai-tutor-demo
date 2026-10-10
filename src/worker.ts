import './lib/load-env'; // must stay first: '@/db/client' builds its pools from DATABASE_URL_* at import time
import { getDeps, startWorker } from '@/modules/content';

const { blobs, embedder, ocr } = getDeps();
const worker = await startWorker({ blobs, embedder, ocr });
console.log('[worker] ingest worker started');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void worker.stop().then(() => process.exit(0));
  });
}
