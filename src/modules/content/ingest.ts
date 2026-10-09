import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db/client';
import { chunks, contentChapters, contentItems } from '@/db/schema';
import type { BlobStore } from './blob';
import { detectChapters } from './chapters';
import { chunkChapter, type ChunkDraft } from './chunker';
import { embedInBatches, type Embedder } from './embedder';
import type { OcrExtractor } from './ocr';
import { extractPdf, splitPage } from './pdf';

export type IngestJob = { contentItemId: string; schoolId: string };
export type IngestDeps = { blobs: BlobStore; embedder: Embedder; ocr: OcrExtractor | null };

const OCR_THRESHOLD = 200;
const INSERT_BATCH = 50;
const EMBED_BATCH = 96;
const MAX_ERROR_CHARS = 300;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function runIngest(
  job: IngestJob,
  deps: IngestDeps,
  opts: { finalAttempt?: boolean } = {},
): Promise<void> {
  const { contentItemId, schoolId } = job;

  // Step 1: mark processing and wipe leftovers of any earlier (crashed or failed) run.
  const fileKey = await withTenant(schoolId, async (tx) => {
    const [item] = await tx
      .select({ fileKey: contentItems.fileKey })
      .from(contentItems)
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.schoolId, schoolId)))
      .for('update');
    if (!item) return null;
    await tx.delete(chunks).where(eq(chunks.contentItemId, contentItemId));
    await tx.delete(contentChapters).where(eq(contentChapters.contentItemId, contentItemId));
    await tx
      .update(contentItems)
      .set({ ingestStatus: 'processing', ingestError: null })
      .where(eq(contentItems.id, contentItemId));
    return item.fileKey;
  });
  if (fileKey === null) return;

  try {
    // Steps 2-5: no transaction held while doing slow I/O.
    const bytes = await deps.blobs.get(fileKey);
    const extracted = await extractPdf(bytes);
    const pages = [...extracted.pages];
    let ocrPages = 0;
    let ocrSkippedPages = 0;
    for (let i = 0; i < pages.length; i++) {
      if (collapse(pages[i]).length >= OCR_THRESHOLD) continue;
      if (deps.ocr) {
        const single = await splitPage(bytes, i + 1);
        pages[i] = await deps.ocr.extract({ pdf: single, pageNumber: i + 1 });
        ocrPages++;
      } else {
        ocrSkippedPages++;
      }
    }

    const spans = detectChapters(pages, extracted.outline);
    const drafts: { span: (typeof spans)[number]; chunks: ChunkDraft[] }[] = [];
    let ordinal = 0;
    for (const span of spans) {
      const chapterPages = pages
        .slice(span.pageStart - 1, span.pageEnd)
        .map((text, i) => ({ page: span.pageStart + i, text }))
        .filter((p) => p.text.trim() !== '');
      const cs = chunkChapter(chapterPages, ordinal);
      ordinal += cs.length;
      drafts.push({ span, chunks: cs });
    }
    const all = drafts.flatMap((d) => d.chunks);
    if (all.length === 0) throw new Error('No extractable text');

    const vectors = await embedInBatches(deps.embedder, all.map((c) => c.text), EMBED_BATCH);

    // Steps 6-7: chapters, chunks and the ready flag become visible atomically.
    await withTenant(schoolId, async (tx) => {
      const locked = await tx
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(and(eq(contentItems.id, contentItemId), eq(contentItems.schoolId, schoolId)))
        .for('update');
      if (locked.length === 0) return; // deleted mid-ingest
      const rows: (typeof chunks.$inferInsert)[] = [];
      let k = 0;
      for (const d of drafts) {
        const [chapter] = await tx
          .insert(contentChapters)
          .values({
            schoolId,
            contentItemId,
            ordinal: d.span.ordinal,
            title: d.span.title,
            pageStart: d.span.pageStart,
            pageEnd: d.span.pageEnd,
          })
          .returning({ id: contentChapters.id });
        for (const c of d.chunks) {
          rows.push({
            schoolId,
            contentItemId,
            chapterId: chapter.id,
            ordinal: c.ordinal,
            pageStart: c.pageStart,
            pageEnd: c.pageEnd,
            text: c.text,
            tokenEstimate: c.tokenEstimate,
            embedding: vectors[k++],
            embeddingModel: deps.embedder.modelId,
            embeddingDim: deps.embedder.dimension,
          });
        }
      }
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await tx.insert(chunks).values(rows.slice(i, i + INSERT_BATCH));
      }
      await tx
        .update(contentItems)
        .set({
          ingestStatus: 'ready',
          ingestError: null,
          pageCount: extracted.pageCount,
          ocrPages,
          ocrSkippedPages,
        })
        .where(eq(contentItems.id, contentItemId));
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);
    const updated = await withTenant(schoolId, (tx) =>
      tx
        .update(contentItems)
        .set({
          ingestError: message,
          ...(opts.finalAttempt ? { ingestStatus: 'failed' } : {}),
        })
        .where(and(eq(contentItems.id, contentItemId), eq(contentItems.schoolId, schoolId)))
        .returning({ id: contentItems.id }),
    );
    if (updated.length === 0) return; // item was deleted mid-ingest: nothing left to fail
    throw err;
  }
}
