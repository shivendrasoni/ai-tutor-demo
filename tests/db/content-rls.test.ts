import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { chunks, contentChapters, contentExclusions, contentItems, tenantTables } from '@/db/schema';
import { appDbRaw, resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
const vec = (n: number) => `[${Array.from({ length: n }, () => '0.1').join(',')}]`;

type SchoolKey = 'a' | 'b';
/** Inserts an item with one chapter, one chunk and one exclusion, as platform. */
async function insertItem(key: SchoolKey, over: Partial<typeof contentItems.$inferInsert> = {}) {
  const s = seed[key];
  return withPlatform(async (tx) => {
    const [item] = await tx
      .insert(contentItems)
      .values({
        schoolId: s.schoolId, grade: 8, subjectId: s.subjectId, kind: 'book', scope: 'school',
        title: `Book ${key}`, fileKey: `${s.schoolId}/x.pdf`, uploadedBy: s.schoolAdmin.userId, sizeBytes: 10,
        ...over,
      })
      .returning();
    const [chapter] = await tx
      .insert(contentChapters)
      .values({ schoolId: s.schoolId, contentItemId: item.id, ordinal: 1, title: 'Ch 1', pageStart: 1, pageEnd: 5 })
      .returning();
    await tx.insert(chunks).values({
      schoolId: s.schoolId, contentItemId: item.id, chapterId: chapter.id, ordinal: 1, pageStart: 1, pageEnd: 1,
      text: 'hello', tokenEstimate: 2, embedding: Array(1536).fill(0.1), embeddingModel: 'fake', embeddingDim: 1536,
    });
    await tx.insert(contentExclusions).values({ schoolId: s.schoolId, branchId: s.branchId, contentItemId: item.id });
    return { itemId: item.id, chapterId: chapter.id };
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await insertItem('a');
  await insertItem('b');
});
afterAll(async () => {
  await closeDb();
});

describe('content tables: RLS and constraints', () => {
  it('tenant context sees only its own items, chapters, and chunks', async () => {
    for (const t of [contentItems, contentChapters, chunks]) {
      const rows = await withTenant(seed.a.schoolId, (tx) => tx.select().from(t));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.schoolId === seed.a.schoolId)).toBe(true);
    }
  });
  it('no tenant context fails closed for all four tables', async () => {
    for (const t of ['content_items', 'content_exclusions', 'content_chapters', 'chunks']) {
      expect((await appDbRaw(sql.raw(`select count(*)::int as n from ${t}`))).rows[0].n).toBe(0);
    }
  });
  it('cannot insert a chunk for another school', async () => {
    const { itemId, chapterId } = await insertItem('a');
    await expect(
      withTenant(seed.a.schoolId, (tx) =>
        tx.insert(chunks).values({
          schoolId: seed.b.schoolId, contentItemId: itemId, chapterId, ordinal: 2, pageStart: 1, pageEnd: 1,
          text: 'x', tokenEstimate: 1, embedding: Array(1536).fill(0), embeddingModel: 'fake', embeddingDim: 1536,
        }),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });
  it('rejects a 1535-dim embedding', async () => {
    const { itemId, chapterId } = await insertItem('a');
    await expect(
      withPlatform((tx) =>
        tx.execute(sql`insert into chunks (school_id, content_item_id, chapter_id, ordinal, page_start, page_end, text,
          token_estimate, embedding, embedding_model, embedding_dim)
          values (${seed.a.schoolId}, ${itemId}, ${chapterId}, 9, 1, 1, 'x', 1, ${vec(1535)}::vector, 'fake', 1535)`),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/dimensions/) } });
  });
  it('deleting an item cascades to chapters, chunks, and exclusions', async () => {
    const { itemId } = await insertItem('a');
    await withPlatform((tx) => tx.delete(contentItems).where(eq(contentItems.id, itemId)));
    for (const t of ['content_chapters', 'chunks', 'content_exclusions']) {
      const r = await withPlatform((tx) => tx.execute(sql.raw(`select count(*)::int as n from ${t} where content_item_id = '${itemId}'`)));
      expect(r.rows[0].n).toBe(0);
    }
  });
  it('rejects a school-scope item that carries a branch_id (scope check)', async () => {
    await expect(insertItem('a', { scope: 'school', branchId: seed.a.branchId })).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/content_items_scope_check/) },
    });
  });
  it('rejects a section-scope item without a branch_id', async () => {
    await expect(insertItem('a', { scope: 'section', sectionId: seed.a.sectionId })).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/content_items_scope_check/) },
    });
  });
  it('accepts a section-scope item with branch and section', async () => {
    await expect(
      insertItem('a', { scope: 'section', branchId: seed.a.branchId, sectionId: seed.a.sectionId }),
    ).resolves.toBeDefined();
  });
  it('has an HNSW index on chunks.embedding', async () => {
    const r = await withPlatform((tx) => tx.execute(sql`select indexdef from pg_indexes where tablename = 'chunks'`));
    expect(r.rows.some((x) => /hnsw.*vector_cosine_ops/.test(String(x.indexdef)))).toBe(true);
  });
  it('tenantTables includes the four content tables (16 total)', () => {
    expect(tenantTables).toHaveLength(16);
    for (const t of [contentItems, contentExclusions, contentChapters, chunks]) expect(tenantTables).toContain(t);
  });
});
