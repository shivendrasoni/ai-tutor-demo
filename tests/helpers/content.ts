import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { chunks, contentChapters, contentItems } from '@/db/schema';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBlobStore } from '@/modules/content/blob';
import { FakeEmbedder } from '@/modules/content/embedder';
import type { IngestJob } from '@/modules/content/ingest';
import type { SchoolSeed } from './db';

let blobStore: LocalBlobStore | undefined;
/** Shared per-process temp blob store; pass it as `deps.blobs` so queueItemFor's uploads are readable. */
export const testBlobs = () => (blobStore ??= new LocalBlobStore(mkdtempSync(join(tmpdir(), 'content-blobs-'))));

type ItemRow = typeof contentItems.$inferSelect;

export async function seedItem(
  school: SchoolSeed,
  overrides: Partial<typeof contentItems.$inferInsert> = {},
): Promise<{ id: string }> {
  const [row] = await withPlatform((tx) =>
    tx
      .insert(contentItems)
      .values({
        schoolId: school.schoolId,
        grade: 8,
        subjectId: school.subjectId,
        kind: 'book',
        scope: 'school',
        title: 'Test Book',
        fileKey: `${school.schoolId}/seed.pdf`,
        uploadedBy: school.schoolAdmin.userId!,
        ingestStatus: 'ready',
        sizeBytes: 1000,
        ...overrides,
      })
      .returning({ id: contentItems.id }),
  );
  return { id: row.id };
}

export async function seedChunks(
  itemId: string,
  chapters: { title: string; texts: string[]; pageStart?: number }[],
): Promise<void> {
  const embedder = new FakeEmbedder();
  await withPlatform(async (tx) => {
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId));
    let ordinal = 0;
    for (const [ci, ch] of chapters.entries()) {
      const pageStart = ch.pageStart ?? ci * 10 + 1;
      const [chapter] = await tx
        .insert(contentChapters)
        .values({
          schoolId: item.schoolId,
          contentItemId: itemId,
          ordinal: ci,
          title: ch.title,
          pageStart,
          pageEnd: pageStart + 9,
        })
        .returning({ id: contentChapters.id });
      const vectors = await embedder.embed(ch.texts);
      for (const [i, text] of ch.texts.entries()) {
        await tx.insert(chunks).values({
          schoolId: item.schoolId,
          contentItemId: itemId,
          chapterId: chapter.id,
          ordinal: ordinal++,
          pageStart,
          pageEnd: pageStart,
          text,
          tokenEstimate: Math.ceil(text.length / 4),
          embedding: vectors[i],
          embeddingModel: embedder.modelId,
          embeddingDim: embedder.dimension,
        });
      }
    }
  });
}

/** Puts the PDF blob and inserts a queued item; returns the job that would ingest it. */
export async function queueItemFor(
  school: SchoolSeed,
  bytes: Uint8Array,
  overrides: Partial<typeof contentItems.$inferInsert> = {},
): Promise<IngestJob> {
  const id = crypto.randomUUID();
  const fileKey = `${school.schoolId}/${id}.pdf`;
  await testBlobs().put(fileKey, bytes);
  await seedItem(school, { id, fileKey, ingestStatus: 'queued', sizeBytes: bytes.length, ...overrides });
  return { contentItemId: id, schoolId: school.schoolId };
}

export async function getItemOrNull(id: string): Promise<ItemRow | null> {
  const rows = await withPlatform((tx) => tx.select().from(contentItems).where(eq(contentItems.id, id)));
  return rows[0] ?? null;
}

export async function getItem(jobOrId: IngestJob | string): Promise<ItemRow> {
  const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.contentItemId;
  const row = await getItemOrNull(id);
  if (!row) throw new Error(`content item ${id} not found`);
  return row;
}
