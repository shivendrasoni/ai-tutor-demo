/**
 * Cross-school isolation for content, chunks and vector search. Every case acts as School A's actors
 * and targets School B ids; each must reject or return no B data, and B's tenant snapshot must not change.
 */
import { eq, getTableName, sql } from 'drizzle-orm';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { contentExclusions, contentItems, studentProfiles, tenantTables } from '@/db/schema';
import {
  InMemoryQueue,
  LocalBlobStore,
  chunksForChapters,
  deleteContent,
  listContent,
  listVisibleChapters,
  listVisibleSubjects,
  retryIngest,
  runIngest,
  searchChunks,
  setDepsForTest,
  setExclusion,
  studentScope,
  uploadContent,
  FakeEmbedder,
  visibleContent,
  type StudentScope,
  type UploadInput,
} from '@/modules/content';
import { resetDb, seedTwoSchools, type Seed, type SchoolSeed } from '../helpers/db';
import { getItem, seedChunks, seedItem } from '../helpers/content';
import { buildPdf } from '../helpers/pdfs';

const SHARED = 'shared phrase about photosynthesis glucose';
const B_ONLY = 'zebra quartz marmalade secret words';

type Ids = { items: Set<string>; chunkIds: Set<string>; chapterIds: string[]; itemId: string };

let seed: Seed;
let a: Ids;
let b: Ids;
let blobs: LocalBlobStore;
let blobDir: string;
let queue: InMemoryQueue;
let pdf: Uint8Array;

async function seedSchoolContent(s: SchoolSeed, bOnly: boolean): Promise<Ids> {
  const main = await seedItem(s, { title: 'Main book' });
  await seedChunks(main.id, [
    { title: 'Chapter 1', texts: [SHARED, ...(bOnly ? [B_ONLY] : [])] },
    { title: 'Chapter 2', texts: [`${SHARED} two`] },
  ]);
  const branchItem = await seedItem(s, { title: 'Branch notes', scope: 'branch', branchId: s.branchId, kind: 'material' });
  await seedChunks(branchItem.id, [{ title: 'Branch chapter', texts: [SHARED] }]);
  const sectionItem = await seedItem(s, { title: 'Section notes', scope: 'section', branchId: s.branchId, sectionId: s.sectionId, kind: 'material' });
  await seedChunks(sectionItem.id, [{ title: 'Section chapter', texts: [SHARED] }]);
  const itemIds = [main.id, branchItem.id, sectionItem.id];
  const { chunkIds, chapterIds } = await withPlatform(async (tx) => {
    const c = await tx.execute(sql`select id from chunks where school_id = ${s.schoolId}`);
    const ch = await tx.execute(sql`select id from content_chapters where school_id = ${s.schoolId}`);
    return { chunkIds: c.rows.map((r) => r.id as string), chapterIds: ch.rows.map((r) => r.id as string) };
  });
  return { items: new Set(itemIds), chunkIds: new Set(chunkIds), chapterIds, itemId: main.id };
}

async function activate(s: SchoolSeed) {
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, s.studentId)),
  );
}

beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  pdf = await buildPdf({ pages: ['Page one text', 'Page two text'] });
  blobDir = mkdtempSync(join(tmpdir(), 'iso-blobs-'));
  blobs = new LocalBlobStore(blobDir);
  queue = new InMemoryQueue();
  setDepsForTest({ blobs, queue, embedder: new FakeEmbedder() });
  a = await seedSchoolContent(seed.a, false);
  b = await seedSchoolContent(seed.b, true);
  await activate(seed.a);
  await activate(seed.b);
});
afterAll(async () => {
  setDepsForTest(null);
  await closeDb();
});

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));

async function snapshot(schoolId: string): Promise<Record<string, unknown[]>> {
  return withPlatform(async (tx) => {
    const out: Record<string, unknown[]> = {};
    for (const T of tenantTables) {
      const res = await tx.execute(sql`select * from ${T} where school_id = ${schoolId} order by ${sql.raw('ctid')}`);
      out[getTableName(T)] = res.rows;
    }
    return out;
  });
}

async function expectDeniedNoBChange(p: () => Promise<unknown>, allowed: string[]) {
  const before = await snapshot(seed.b.schoolId);
  expect(allowed).toContain(await codeOf(p()));
  expect(await snapshot(seed.b.schoolId)).toEqual(before);
}

const scopeA = (): Promise<StudentScope> => studentScope(seed.a.student);
const upload = (over: Partial<UploadInput>): UploadInput => ({
  scope: 'school', schoolId: seed.a.schoolId, grade: 8, subjectId: seed.a.subjectId, kind: 'book',
  title: 'Intruder', file: { bytes: pdf, filename: 'x.pdf' }, ...over,
});

describe('content isolation: School A actors vs School B ids', () => {
  it('raw RLS: content tables are in tenantTables and return only own-school rows', async () => {
    expect(tenantTables).toHaveLength(16);
    const names = tenantTables.map((t) => getTableName(t));
    for (const n of ['content_items', 'content_exclusions', 'content_chapters', 'chunks']) expect(names).toContain(n);
    await withPlatform((tx) =>
      tx.insert(contentExclusions).values({ schoolId: seed.b.schoolId, branchId: seed.b.branchId, contentItemId: b.itemId }),
    );
    for (const t of tenantTables) {
      const rows = (await withTenant(seed.a.schoolId, (tx) => tx.select().from(t))) as { schoolId?: string; id: string }[];
      expect(rows.every((r) => (r.schoolId ?? r.id) === seed.a.schoolId), getTableName(t)).toBe(true);
    }
    const chunkRows = await withTenant(seed.a.schoolId, (tx) => tx.execute(sql`select id from chunks`));
    expect(new Set(chunkRows.rows.map((r) => r.id))).toEqual(a.chunkIds);
  });

  it('searchChunks as A never returns B chunks, even for B-only text and with B filters', async () => {
    const scope = await scopeA();
    const hits = await searchChunks(scope, SHARED);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => a.chunkIds.has(h.chunkId))).toBe(true);
    expect((await searchChunks(scope, B_ONLY)).every((h) => a.chunkIds.has(h.chunkId))).toBe(true);
    expect(
      await searchChunks(scope, B_ONLY, { subjectIds: [seed.b.subjectId], chapterIds: b.chapterIds }),
    ).toEqual([]);
    expect(await searchChunks(scope, SHARED, { chapterIds: b.chapterIds })).toEqual([]);
    expect(await searchChunks(scope, SHARED, { subjectIds: [seed.b.subjectId] })).toEqual([]);
  });

  it('forged scopes in both directions see no data from the other school', async () => {
    const forgedAB: StudentScope = { schoolId: seed.a.schoolId, branchId: seed.b.branchId, sectionId: seed.b.sectionId, grade: 8 };
    const forgedBA: StudentScope = { schoolId: seed.b.schoolId, branchId: seed.a.branchId, sectionId: seed.a.sectionId, grade: 8 };
    const cases: [StudentScope, Ids, Ids][] = [
      [forgedAB, a, b], // acts in A with B's branch/section: nothing of B
      [forgedBA, b, a], // acts in B with A's branch/section: nothing of A
    ];
    for (const [forged, own, other] of cases) {
      const items = await visibleContent(forged);
      expect(items.every((i) => own.items.has(i.id))).toBe(true);
      expect(items.some((i) => other.items.has(i.id))).toBe(false);
      // Branch/section items of the forged-in branch/section ids belong to the other school: not visible.
      expect(items.every((i) => i.scope === 'school')).toBe(true);
      const hits = await searchChunks(forged, SHARED);
      expect(hits.length).toBeGreaterThan(0); // non-vacuous: own school-wide content still found
      expect(hits.every((h) => own.chunkIds.has(h.chunkId))).toBe(true);
      expect(hits.some((h) => other.chunkIds.has(h.chunkId))).toBe(false);
      const ch = await chunksForChapters(forged, [...other.chapterIds], 100_000);
      expect(ch).toEqual([]);
      const own2 = await chunksForChapters(forged, [...own.chapterIds], 100_000);
      expect(own2.length).toBeGreaterThan(0);
      expect(own2.every((h) => own.chunkIds.has(h.chunkId))).toBe(true);
    }
    // High-match B-only text through an A-schoolId forged scope.
    const bOnly = await searchChunks(forgedAB, B_ONLY);
    expect(bOnly.some((h) => b.chunkIds.has(h.chunkId))).toBe(false);
  });

  it('chunksForChapters / listVisibleChapters / listVisibleSubjects with B ids return nothing of B', async () => {
    const scope = await scopeA();
    expect(await chunksForChapters(scope, b.chapterIds, 100_000)).toEqual([]);
    const mixed = await chunksForChapters(scope, [...b.chapterIds, ...a.chapterIds], 100_000);
    expect(mixed.length).toBeGreaterThan(0);
    expect(mixed.every((h) => a.chunkIds.has(h.chunkId))).toBe(true);
    expect(await listVisibleChapters(scope, seed.b.subjectId)).toEqual([]);
    const subjects = await listVisibleSubjects(scope);
    expect(subjects.map((s) => s.id)).toEqual([seed.a.subjectId]);
    expect((await visibleContent(scope)).every((i) => a.items.has(i.id))).toBe(true);
  });

  it('deleteContent, retryIngest on a B item as A school_admin: NOT_FOUND, B item untouched', async () => {
    const failed = await seedItem(seed.b, { title: 'Failed', ingestStatus: 'failed', ingestError: 'boom' });
    await expectDeniedNoBChange(() => deleteContent(seed.a.schoolAdmin, b.itemId), ['NOT_FOUND']);
    await expectDeniedNoBChange(() => deleteContent(seed.a.schoolAdmin, failed.id), ['NOT_FOUND']);
    await expectDeniedNoBChange(() => retryIngest(seed.a.schoolAdmin, failed.id), ['NOT_FOUND']);
    expect(queue.jobs).toEqual([]);
    expect((await getItem(failed.id)).ingestStatus).toBe('failed');
    expect((await getItem(b.itemId)).ingestStatus).toBe('ready');
  });

  it('setExclusion for a B branch/item as A school_admin rejects; no exclusion row created', async () => {
    await expectDeniedNoBChange(
      () => setExclusion(seed.a.schoolAdmin, { branchId: seed.b.branchId, contentItemId: b.itemId, excluded: true }),
      ['NOT_FOUND'],
    );
    const aItem = [...a.items][0];
    await expectDeniedNoBChange(
      () => setExclusion(seed.a.schoolAdmin, { branchId: seed.b.branchId, contentItemId: aItem, excluded: true }),
      ['VALIDATION', 'FORBIDDEN', 'NOT_FOUND'],
    );
    await expectDeniedNoBChange(
      () => setExclusion(seed.a.schoolAdmin, { branchId: seed.a.branchId, contentItemId: b.itemId, excluded: true }),
      ['NOT_FOUND'],
    );
    const rows = await withPlatform((tx) => tx.select().from(contentExclusions));
    expect(rows).toHaveLength(0);
  });

  it('uploadContent with B schoolId / B subject / B section as A school_admin rejects; no B rows, blob or job', async () => {
    const countItems = async () => (await withPlatform((tx) => tx.select().from(contentItems))).length;
    const before = await countItems();
    await expectDeniedNoBChange(
      () => uploadContent(seed.a.schoolAdmin, upload({ schoolId: seed.b.schoolId, subjectId: seed.b.subjectId })),
      ['FORBIDDEN'],
    );
    await expectDeniedNoBChange(
      () => uploadContent(seed.a.schoolAdmin, upload({ subjectId: seed.b.subjectId })),
      ['VALIDATION', 'FORBIDDEN', 'NOT_FOUND'],
    );
    await expectDeniedNoBChange(
      () => uploadContent(seed.a.schoolAdmin, upload({ scope: 'section', branchId: seed.a.branchId, sectionId: seed.b.sectionId, kind: 'material' })),
      ['VALIDATION', 'FORBIDDEN', 'NOT_FOUND'],
    );
    await expectDeniedNoBChange(
      () => uploadContent(seed.a.schoolAdmin, upload({ scope: 'branch', branchId: seed.b.branchId })),
      ['VALIDATION', 'FORBIDDEN', 'NOT_FOUND'],
    );
    expect(await countItems()).toBe(before);
    expect(readdirSync(blobDir, { recursive: true })).toEqual([]);
    expect(queue.jobs).toEqual([]);
  });

  it('listContent as A school_admin returns no B items, even filtered by B branchId or subjectId', async () => {
    const own = await listContent(seed.a.schoolAdmin, {});
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((i) => a.items.has(i.id))).toBe(true);
    for (const filter of [{ branchId: seed.b.branchId }, { subjectId: seed.b.subjectId }]) {
      const r = await listContent(seed.a.schoolAdmin, filter).catch((e) => e.code as string);
      if (typeof r === 'string') expect(['FORBIDDEN', 'VALIDATION', 'NOT_FOUND']).toContain(r);
      else expect(r.some((i) => b.items.has(i.id))).toBe(false);
    }
  });

  it('studentScope(a.student) is school A; studentScope(b.student) is school B', async () => {
    expect((await studentScope(seed.a.student)).schoolId).toBe(seed.a.schoolId);
    expect((await studentScope(seed.a.student)).branchId).toBe(seed.a.branchId);
    expect((await studentScope(seed.b.student)).schoolId).toBe(seed.b.schoolId);
    expect((await studentScope(seed.b.student)).branchId).toBe(seed.b.branchId);
  });

  it('a pg-boss job with School A id and a B item id is a no-op', async () => {
    const queued = await seedItem(seed.b, { title: 'Queued', ingestStatus: 'queued' });
    const before = await snapshot(seed.b.schoolId);
    await runIngest(
      { contentItemId: queued.id, schoolId: seed.a.schoolId },
      { blobs, embedder: new FakeEmbedder(), ocr: null },
    );
    expect((await getItem(queued.id)).ingestStatus).toBe('queued');
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
  });
});
