import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { chunks, contentChapters, contentItems } from '@/db/schema';
import { FakeEmbedder, type Embedder } from '@/modules/content/embedder';
import { runIngest, type IngestDeps, type IngestJob } from '@/modules/content/ingest';
import { FakeOcrExtractor } from '@/modules/content/ocr';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { getItem, queueItemFor, seedChunks, testBlobs } from '../helpers/content';
import { buildPdf, exactText, headingBook, scannedBook, textBook30 } from '../helpers/pdfs';

let seed: Seed;
let ocr: FakeOcrExtractor;
let deps: IngestDeps;

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
beforeEach(() => {
  ocr = new FakeOcrExtractor((n) => 'OCR page ' + n + ' ' + 'ocr body text '.repeat(30));
  deps = { blobs: testBlobs(), embedder: new FakeEmbedder(), ocr };
});

const chaptersOf = (j: IngestJob) =>
  withPlatform((tx) =>
    tx.select().from(contentChapters).where(eq(contentChapters.contentItemId, j.contentItemId)).orderBy(contentChapters.ordinal),
  );
const chunksOf = (j: IngestJob) =>
  withPlatform((tx) =>
    tx
      .select({
        text: chunks.text,
        ordinal: chunks.ordinal,
        pageStart: chunks.pageStart,
        pageEnd: chunks.pageEnd,
        embeddingModel: chunks.embeddingModel,
        embeddingDim: chunks.embeddingDim,
        chapterPageStart: contentChapters.pageStart,
        chapterPageEnd: contentChapters.pageEnd,
      })
      .from(chunks)
      .innerJoin(contentChapters, eq(chunks.chapterId, contentChapters.id))
      .where(eq(chunks.contentItemId, j.contentItemId))
      .orderBy(chunks.ordinal),
  );
const countChunks = async (j: IngestJob) => (await chunksOf(j)).length;
const countChapters = async (j: IngestJob) => (await chaptersOf(j)).length;

const failing = (msg: string): Embedder => ({
  modelId: 'x',
  dimension: 1536,
  embed: async () => {
    throw new Error(msg);
  },
});

describe('runIngest', () => {
  it('text book with outline: 3 chapters, exact page ranges, ready', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await runIngest(job, deps);
    const item = await getItem(job);
    expect(item).toMatchObject({ ingestStatus: 'ready', pageCount: 30, ocrPages: 0, ocrSkippedPages: 0, ingestError: null });
    expect((await chaptersOf(job)).map((c) => [c.title, c.pageStart, c.pageEnd])).toEqual([
      ['Chapter 1', 1, 10],
      ['Chapter 2', 11, 20],
      ['Chapter 3', 21, 30],
    ]);
    const ch = await chunksOf(job);
    expect(ch.length).toBeGreaterThanOrEqual(3);
    expect(ch.every((c) => c.embeddingModel === 'fake:hash-1536' && c.embeddingDim === 1536)).toBe(true);
    expect(ch.every((c) => c.pageStart >= c.chapterPageStart && c.pageEnd <= c.chapterPageEnd)).toBe(true);
    expect(ch.map((c) => c.ordinal)).toEqual(ch.map((_, i) => i)); // global ordinals
  });

  it('heading book without outline: Chapter 1 / CHAPTER 2 spans 1–6 and 7–12', async () => {
    const job = await queueItemFor(seed.a, await headingBook());
    await runIngest(job, deps);
    const spans = await chaptersOf(job);
    expect(spans.map((c) => [c.pageStart, c.pageEnd])).toEqual([[1, 6], [7, 12]]);
    expect(spans[0].title).toMatch(/^Chapter 1/);
    expect(spans[1].title).toMatch(/^CHAPTER 2/);
  });

  it('scanned pages are OCRed: ocr_pages = 3 and their text is replaced by the OCR output', async () => {
    const job = await queueItemFor(seed.a, await scannedBook());
    await runIngest(job, deps);
    expect(await getItem(job)).toMatchObject({ ocrPages: 3, ocrSkippedPages: 0 });
    expect(ocr.calls).toEqual([2, 3, 4]);
    expect((await chunksOf(job)).some((c) => c.text.includes('OCR page 3'))).toBe(true);
  });

  it('without an OCR extractor the low-text pages are skipped and counted, item still ready', async () => {
    const job = await queueItemFor(seed.a, await scannedBook());
    await runIngest(job, { ...deps, ocr: null });
    expect(await getItem(job)).toMatchObject({ ingestStatus: 'ready', ocrPages: 0, ocrSkippedPages: 3 });
  });

  it('a PDF with no extractable text at all fails with a clear error', async () => {
    const job = await queueItemFor(seed.a, await buildPdf({ pages: ['', ''] }));
    await expect(runIngest(job, { ...deps, ocr: null }, { finalAttempt: true })).rejects.toThrow(/no extractable text/i);
    expect(await getItem(job)).toMatchObject({ ingestStatus: 'failed', ingestError: expect.stringMatching(/no extractable text/i) });
  });

  it('page with exactly 200 chars is not OCRed; 199 is', async () => {
    const job = await queueItemFor(seed.a, await buildPdf({ pages: [exactText(200), exactText(199), exactText(1000)] }));
    await runIngest(job, deps);
    expect(ocr.calls).toEqual([2]);
    expect(await getItem(job)).toMatchObject({ ocrPages: 1 });
  });

  it('truncates long errors to 300 chars', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await runIngest(job, { ...deps, embedder: failing('e'.repeat(1000)) }, { finalAttempt: true }).catch(() => {});
    expect((await getItem(job)).ingestError).toHaveLength(300);
  });

  it('embedder failure on the final attempt: failed, error recorded, zero chunks/chapters', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await expect(runIngest(job, { ...deps, embedder: failing('embedding provider down') }, { finalAttempt: true })).rejects.toThrow(
      'embedding provider down',
    );
    expect(await getItem(job)).toMatchObject({ ingestStatus: 'failed', ingestError: expect.stringContaining('embedding provider down') });
    expect(await countChunks(job)).toBe(0);
    expect(await countChapters(job)).toBe(0);
  });

  it('embedder failure on a non-final attempt leaves the item processing (not failed), zero chunks', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await expect(runIngest(job, { ...deps, embedder: failing('flaky') })).rejects.toThrow('flaky');
    expect(await getItem(job)).toMatchObject({ ingestStatus: 'processing', ingestError: 'flaky' });
    expect(await countChunks(job)).toBe(0);
  });

  it('re-ingest after partial failure: stale chapters/chunks are replaced, not duplicated', async () => {
    const bytes = await textBook30();
    const job = await queueItemFor(seed.a, bytes);
    const clean = await queueItemFor(seed.a, bytes);
    await runIngest(clean, deps);
    const cleanChunks = await countChunks(clean);

    await seedChunks(job.contentItemId, [{ title: 'STALE', texts: ['stale chunk'] }]);
    await runIngest(job, deps);
    expect(await countChunks(job)).toBe(cleanChunks);
    expect((await chaptersOf(job)).some((c) => c.title === 'STALE')).toBe(false);
    await runIngest(job, deps);
    expect(await countChunks(job)).toBe(cleanChunks);
    expect(await countChapters(job)).toBe(3);
  });

  it('fail then retry succeeds and clears ingest_error', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await runIngest(job, { ...deps, embedder: failing('boom') }, { finalAttempt: true }).catch(() => {});
    await runIngest(job, deps);
    expect(await getItem(job)).toMatchObject({ ingestStatus: 'ready', ingestError: null });
  });

  it('chunks become visible to other transactions only together with status ready', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    const samples: [string, number][] = [];
    const fake = new FakeEmbedder();
    const spy: Embedder = {
      modelId: fake.modelId,
      dimension: fake.dimension,
      embed: async (t) => {
        const item = await getItem(job);
        samples.push([item.ingestStatus, await countChunks(job)]);
        return fake.embed(t);
      },
    };
    await runIngest(job, { ...deps, embedder: spy });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(([s, n]) => s === 'processing' && n === 0)).toBe(true);
    expect([(await getItem(job)).ingestStatus, (await countChunks(job)) > 0]).toEqual(['ready', true]);
  });

  it('item deleted while embedding: handler resolves, no orphan chunks or chapters', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    const fake = new FakeEmbedder();
    const slow: Embedder = {
      modelId: fake.modelId,
      dimension: fake.dimension,
      embed: async (t) => {
        await withPlatform((tx) => tx.delete(contentItems).where(eq(contentItems.id, job.contentItemId)));
        return fake.embed(t);
      },
    };
    await expect(runIngest(job, { ...deps, embedder: slow })).resolves.toBeUndefined();
    expect(await countChunks(job)).toBe(0);
    expect(await countChapters(job)).toBe(0);
  });

  it('item already deleted before the job runs, or schoolId mismatch, is a no-op', async () => {
    const job = await queueItemFor(seed.a, await textBook30());
    await expect(runIngest({ ...job, schoolId: seed.b.schoolId }, deps)).resolves.toBeUndefined();
    expect((await getItem(job)).ingestStatus).toBe('queued');
    await withPlatform((tx) => tx.delete(contentItems).where(eq(contentItems.id, job.contentItemId)));
    await expect(runIngest(job, deps)).resolves.toBeUndefined();
  });
});
