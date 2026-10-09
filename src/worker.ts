import { config } from 'dotenv';
import { getDeps } from '@/modules/content/deps';
import { startWorker } from '@/modules/content/queue';

config({ quiet: true });

const { blobs, embedder, ocr } = getDeps();
const worker = await startWorker({ blobs, embedder, ocr });
console.log('[worker] ingest worker started');

process.on('SIGTERM', () => {
  void worker.stop().then(() => process.exit(0));
});
