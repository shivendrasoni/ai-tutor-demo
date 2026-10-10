import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withPlatform } from '@/db/client';
import { chunks, contentChapters, contentExclusions, studentProfiles } from '@/db/schema';
import { chunksForChapters, searchChunks, setDepsForTest, studentScope, type StudentScope } from '@/modules/content';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { seedChunks, seedItem } from '../helpers/content';

let seed: Seed;
let scope: StudentScope;
let mathChapter: string;
let plantsChapter: string;
let bChapter: string;
let excludedChapter: string;
let queuedChapter: string;
let wrongGradeChapter: string;

const chapterIdOf = async (itemId: string): Promise<string> =>
  (await withPlatform((tx) => tx.select().from(contentChapters).where(eq(contentChapters.contentItemId, itemId))))[0].id;

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, seed.a.studentId)),
  );
  scope = await studentScope(seed.a.student);

  const math = await seedItem(seed.a, { title: 'Math book' });
  await seedChunks(math.id, [
    { title: 'Ch Algebra', texts: ['quadratic equations have two roots found by the quadratic formula', 'linear equations graph as straight lines'] },
  ]);
  mathChapter = await chapterIdOf(math.id);
  const sci = await seedItem(seed.a, { title: 'Sci book', subjectId: seed.a.subjectId });
  await seedChunks(sci.id, [{ title: 'Ch Plants', texts: ['photosynthesis converts sunlight water and carbon dioxide into glucose'] }]);
  plantsChapter = await chapterIdOf(sci.id);

  // Hidden items whose text matches best.
  const text = 'photosynthesis glucose sunlight photosynthesis glucose sunlight';
  const b = await seedItem(seed.b, { title: 'B book' });
  await seedChunks(b.id, [{ title: 'B ch', texts: [text] }]);
  bChapter = await chapterIdOf(b.id);
  const ex = await seedItem(seed.a, { title: 'Excluded' });
  await seedChunks(ex.id, [{ title: 'Ex ch', texts: [text] }]);
  excludedChapter = await chapterIdOf(ex.id);
  await withPlatform((tx) =>
    tx.insert(contentExclusions).values({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, contentItemId: ex.id }),
  );
  const q = await seedItem(seed.a, { title: 'Queued', ingestStatus: 'queued' });
  await seedChunks(q.id, [{ title: 'Q ch', texts: [text] }]);
  queuedChapter = await chapterIdOf(q.id);
  const g = await seedItem(seed.a, { title: 'Grade9', grade: 9 });
  await seedChunks(g.id, [{ title: 'G ch', texts: [text] }]);
  wrongGradeChapter = await chapterIdOf(g.id);
});

describe('searchChunks', () => {
  it('ranks the chunk sharing the query words first with full ChunkHit fields', async () => {
    const hits = await searchChunks(scope, 'how are quadratic equations solved by the quadratic formula');
    expect(hits[0]).toMatchObject({
      itemTitle: 'Math book',
      subjectName: 'Mathematics',
      chapterTitle: 'Ch Algebra',
      chapterId: mathChapter,
      pageStart: expect.any(Number),
      pageEnd: expect.any(Number),
    });
    expect(hits[0].text).toContain('quadratic formula');
    expect(hits[0].similarity).toBeGreaterThan(0.25);
    const sims = hits.map((h) => h.similarity);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });

  it('applies minSimilarity (default 0.25) and limit (default 8, override, clamp)', async () => {
    expect(await searchChunks(scope, 'zebra giraffe savanna')).toEqual([]);
    const weak = await searchChunks(scope, 'quadratic zebra giraffe savanna lion elephant rhino hippo cheetah', { minSimilarity: 0 });
    expect(weak.length).toBeGreaterThan(1);
    expect(await searchChunks(scope, 'quadratic zebra giraffe savanna lion elephant rhino hippo cheetah')).toEqual([]);

    const many = await seedItem(seed.a, { title: 'Many', subjectId: seed.a.subjectId });
    await seedChunks(many.id, [{ title: 'Many ch', texts: Array.from({ length: 12 }, (_, i) => `dinosaur fossils bones ${i}`) }]);
    const manyCh = await chapterIdOf(many.id);
    expect(await searchChunks(scope, 'dinosaur fossils bones', { chapterIds: [manyCh] })).toHaveLength(8);
    expect(await searchChunks(scope, 'dinosaur fossils bones', { chapterIds: [manyCh], limit: 3 })).toHaveLength(3);
    expect(await searchChunks(scope, 'dinosaur fossils bones', { chapterIds: [manyCh], limit: 0 })).toHaveLength(1);
    expect(await searchChunks(scope, 'dinosaur fossils bones', { chapterIds: [manyCh], limit: 999 })).toHaveLength(12);
  });

  it('subject and chapter filters narrow results', async () => {
    expect(await searchChunks(scope, 'photosynthesis glucose', { subjectIds: [seed.b.subjectId] })).toEqual([]);
    expect((await searchChunks(scope, 'photosynthesis glucose', { chapterIds: [plantsChapter] }))[0].chapterTitle).toBe('Ch Plants');
    const bySubject = await searchChunks(scope, 'photosynthesis glucose', { subjectIds: [seed.a.subjectId] });
    expect(bySubject[0].chapterTitle).toBe('Ch Plants');
  });

  it('filters that are all invisible return [] and never fall back to an unfiltered search', async () => {
    const q = 'photosynthesis glucose sunlight';
    expect(await searchChunks(scope, q)).not.toEqual([]);
    for (const opts of [
      { subjectIds: [seed.b.subjectId] },
      { chapterIds: [bChapter] },
      { chapterIds: [excludedChapter] },
      { chapterIds: [queuedChapter] },
      { chapterIds: [wrongGradeChapter] },
      { subjectIds: [seed.b.subjectId], chapterIds: [plantsChapter] },
      { chapterIds: ['not-a-uuid'] },
      { subjectIds: ["x'; drop table chunks;--"] },
    ])
      expect(await searchChunks(scope, q, opts)).toEqual([]);
  });

  it('a mix of visible and invisible ids silently drops the invisible ones', async () => {
    const hits = await searchChunks(scope, 'photosynthesis glucose sunlight', {
      chapterIds: [plantsChapter, bChapter, excludedChapter, 'junk'],
    });
    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set([plantsChapter]));
  });

  it('empty arrays mean no filter', async () => {
    const hits = await searchChunks(scope, 'photosynthesis glucose', { subjectIds: [], chapterIds: [] });
    expect(hits[0].chapterTitle).toBe('Ch Plants');
  });

  it('never returns chunks of hidden, excluded, wrong-grade, or non-ready items even if their text matches best', async () => {
    const hits = await searchChunks(scope, 'photosynthesis glucose sunlight photosynthesis glucose sunlight', { minSimilarity: 0 });
    const titles = new Set(hits.map((h) => h.itemTitle));
    for (const t of ['B book', 'Excluded', 'Queued', 'Grade9']) expect(titles).not.toContain(t);
    expect(hits[0].chapterTitle).toBe('Ch Plants');
  });

  it('ignores chunks embedded with a different embedding_model', async () => {
    const it = await seedItem(seed.a, { title: 'Other model' });
    await seedChunks(it.id, [{ title: 'Om ch', texts: ['volcano magma lava eruption'] }]);
    expect((await searchChunks(scope, 'volcano magma lava eruption')).length).toBe(1);
    await withPlatform((tx) => tx.update(chunks).set({ embeddingModel: 'openai:text-embedding-3-small' }).where(eq(chunks.contentItemId, it.id)));
    expect(await searchChunks(scope, 'volcano magma lava eruption')).toEqual([]);
  });
});

describe('searchChunks with other tenants dominating the index', () => {
  it('returns all of the tenant hits even when many closer chunks belong to another school', async () => {
    const q = 'tectonic plates earthquake fault';
    const bItem = await seedItem(seed.b, { title: 'B quakes' });
    await seedChunks(bItem.id, [{ title: 'B q', texts: Array.from({ length: 60 }, () => q) }]);
    const aItem = await seedItem(seed.a, { title: 'A quakes' });
    await seedChunks(aItem.id, [{ title: 'A q', texts: [1, 2, 3].map((i) => `tectonic plates earthquake fault line ${i}`) }]);
    const hits = await searchChunks(scope, q, { limit: 8 });
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.itemTitle === 'A quakes')).toBe(true);
  });
});

describe('chunksForChapters', () => {
  const tokens = (h: { text: string }) => Math.ceil(h.text.length / 4);
  const big = (tag: string, i: number) => `${tag}${i} ${'x'.repeat(1990)}`; // ~500 tokens

  it('returns document order; all chunks when within maxTokens', async () => {
    const hits = await chunksForChapters(scope, [plantsChapter, mathChapter], 100000);
    expect(hits.map((h) => h.chapterId)).toEqual([plantsChapter, mathChapter, mathChapter]);
    expect(hits.slice(1).map((h) => h.text)).toEqual([
      'quadratic equations have two roots found by the quadratic formula',
      'linear equations graph as straight lines',
    ]);
  });

  it('samples evenly, keeps every chapter, respects maxTokens', async () => {
    const it = await seedItem(seed.a, { title: 'Big' });
    await seedChunks(it.id, [
      { title: 'c1', texts: Array.from({ length: 10 }, (_, i) => big('a', i)) },
      { title: 'c2', texts: [big('b', 0), big('b', 1)] },
      { title: 'c3', texts: [big('c', 0)] },
    ]);
    const chapters = await withPlatform((tx) => tx.select().from(contentChapters).where(eq(contentChapters.contentItemId, it.id)));
    const [c1, c2, c3] = ['c1', 'c2', 'c3'].map((t) => chapters.find((c) => c.title === t)!.id);
    const r = await chunksForChapters(scope, [c1, c2, c3], 2000);
    expect(new Set(r.map((h) => h.chapterId))).toEqual(new Set([c1, c2, c3]));
    expect(r.reduce((s, h) => s + tokens(h), 0)).toBeLessThanOrEqual(2000);
    expect(r.length).toBe(4);
    const order = [c1, c2, c3];
    const idx = r.map((h) => order.indexOf(h.chapterId));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // within a chapter, chunks stay in ordinal order
    const c1Texts = r.filter((h) => h.chapterId === c1).map((h) => Number(h.text.slice(1, 2)));
    expect(c1Texts).toEqual([...c1Texts].sort((a, b) => a - b));
    // given order is honoured (reversed)
    const rev = await chunksForChapters(scope, [c3, c2, c1], 2000);
    expect(rev[0].chapterId).toBe(c3);
  });

  it('drops invisible chapter ids, and returns [] if none are visible', async () => {
    const hits = await chunksForChapters(scope, [bChapter, plantsChapter, excludedChapter, queuedChapter, 'junk'], 100000);
    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set([plantsChapter]));
    expect(await chunksForChapters(scope, [bChapter, excludedChapter, queuedChapter, 'junk'], 100000)).toEqual([]);
    expect(await chunksForChapters(scope, [], 100000)).toEqual([]);
  });
});

describe('searchChunks query handling', () => {
  it('empty or whitespace query returns [] without calling the embedder', async () => {
    let calls = 0;
    setDepsForTest({ embedder: { modelId: 'fake:hash-1536', dimension: 1536, embed: async () => { calls++; return []; } } });
    try {
      expect(await searchChunks(scope, '')).toEqual([]);
      expect(await searchChunks(scope, '  \n\t ')).toEqual([]);
      expect(calls).toBe(0);
    } finally {
      setDepsForTest(null);
    }
  });

  it('works when unrelated deps are misconfigured (bad OCR_MODEL / S3 config)', async () => {
    const saved = { OCR_MODEL: process.env.OCR_MODEL, S3_BUCKET: process.env.S3_BUCKET, EMBEDDER: process.env.EMBEDDER };
    process.env.OCR_MODEL = 'nonsense/model';
    process.env.S3_BUCKET = 'bucket-without-credentials-or-region';
    process.env.EMBEDDER = 'fake';
    setDepsForTest(null);
    vi.resetModules(); // fresh deps module: nothing memoised from earlier tests
    try {
      const { searchChunks: freshSearch } = await import('@/modules/content');
      const hits = await freshSearch(scope, 'quadratic equations roots');
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      setDepsForTest(null);
    }
  });
});
