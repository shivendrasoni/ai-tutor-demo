import { and, eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { chunks, contentExclusions, contentItems } from '@/db/schema';
import {
  InMemoryQueue,
  LocalBlobStore,
  MAX_UPLOAD_BYTES,
  deleteContent,
  listContent,
  listUploadTargets,
  retryIngest,
  runIngest,
  setDepsForTest,
  setExclusion,
  uploadContent,
  FakeEmbedder,
  type UploadInput,
} from '@/modules/content';
import {
  assignTeacher,
  createBranch,
  createSection,
  createStaffUser,
  createSubject,
  listSubjects,
  type Actor,
} from '@/modules/tenancy';
import { SEED_PASSWORD, resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { getItem, getItemOrNull, seedChunks, seedItem } from '../helpers/content';
import { buildPdf } from '../helpers/pdfs';

let seed: Seed;
let blobs: LocalBlobStore;
let queue: InMemoryQueue;
let bytes: Uint8Array;
let n = 0;

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  bytes = await buildPdf({ pages: ['Page one text', 'Page two text'] });
});
beforeEach(() => {
  blobs = new LocalBlobStore(mkdtempSync(join(tmpdir(), 'svc-blobs-')));
  queue = new InMemoryQueue();
  setDepsForTest({ blobs, queue });
});

const up = (actor: Actor, over: Partial<UploadInput> = {}) =>
  uploadContent(actor, {
    scope: 'school',
    schoolId: seed.a.schoolId,
    grade: 8,
    subjectId: seed.a.subjectId,
    kind: 'book',
    title: 'Algebra',
    file: { bytes, filename: 'a.pdf' },
    ...(over.scope && over.scope !== 'school' ? { branchId: seed.a.branchId } : {}),
    ...(over.scope === 'section' ? { sectionId: seed.a.sectionId } : {}),
    ...over,
  });

async function newTeacher(school: Seed['a']): Promise<Actor> {
  const { userId } = await createStaffUser(school.schoolAdmin, {
    schoolId: school.schoolId,
    branchId: school.branchId,
    role: 'teacher',
    username: `teach_${Date.now()}_${n++}`,
    password: SEED_PASSWORD,
    name: 'T',
  });
  return { userId, isPlatformAdmin: false, schoolId: school.schoolId, branchId: school.branchId, roles: ['teacher'] };
}

describe('uploadContent', () => {
  it('stores the blob, creates a queued item, and enqueues exactly one job', async () => {
    const { id } = await up(seed.a.schoolAdmin, { scope: 'school', kind: 'book' });
    expect(await getItem(id)).toMatchObject({
      ingestStatus: 'queued',
      sizeBytes: bytes.length,
      fileKey: `${seed.a.schoolId}/${id}.pdf`,
      uploadedBy: seed.a.schoolAdmin.userId,
    });
    expect((await blobs.get(`${seed.a.schoolId}/${id}.pdf`)).length).toBe(bytes.length);
    expect(queue.jobs).toEqual([{ contentItemId: id, schoolId: seed.a.schoolId }]);
  });

  describe('authz', () => {
    const cases: [string, string, Partial<UploadInput>, boolean][] = [
      ['school_admin', 'a.schoolAdmin', { scope: 'school', kind: 'book' }, true],
      ['branch_admin school scope', 'a.branchAdmin', { scope: 'school', kind: 'book' }, false],
      ['branch_admin branch scope', 'a.branchAdmin', { scope: 'branch', kind: 'book' }, true],
      ['branch_admin section scope', 'a.branchAdmin', { scope: 'section', kind: 'material' }, true],
      ['teacher unassigned', 'fresh', { scope: 'section', kind: 'material' }, false],
      ['teacher book at section', 'a.teacher', { scope: 'section', kind: 'book' }, false],
      ['teacher branch material', 'a.teacher', { scope: 'branch', kind: 'material' }, false],
      ['teacher assigned section material', 'a.teacher', { scope: 'section', kind: 'material' }, true],
      ['teacher assigned to other subject', 'other', { scope: 'section', kind: 'material' }, false],
      ['student', 'a.student', { scope: 'section', kind: 'material' }, false],
      ['school_admin B into school A', 'b.schoolAdmin', { scope: 'school', kind: 'book' }, false],
      ['branch_admin of another branch', 'otherBranch', { scope: 'branch', kind: 'book' }, false],
    ];
    it.each(cases)('%s', async (_name, who, over, allowed) => {
      let actor: Actor;
      if (who === 'fresh') actor = await newTeacher(seed.a);
      else if (who === 'other') {
        actor = await newTeacher(seed.a);
        const subj = await createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `Sci${n++}` });
        await assignTeacher(seed.a.schoolAdmin, { teacherId: actor.userId, sectionId: seed.a.sectionId, subjectId: subj.id });
      } else if (who === 'otherBranch') {
        const br = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `B${n++}` });
        const { userId } = await createStaffUser(seed.a.schoolAdmin, {
          schoolId: seed.a.schoolId, branchId: br.id, role: 'branch_admin',
          username: `ba_${Date.now()}_${n++}`, password: SEED_PASSWORD, name: 'BA',
        });
        actor = { userId, isPlatformAdmin: false, schoolId: seed.a.schoolId, branchId: br.id, roles: ['branch_admin'] };
      } else {
        const [s, k] = who.split('.') as ['a' | 'b', keyof Seed['a']];
        actor = seed[s][k] as Actor;
      }
      const p = up(actor, over);
      if (allowed) await expect(p).resolves.toHaveProperty('id');
      else await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN' });
      if (!allowed) expect(queue.jobs).toHaveLength(0);
    });
  });

  it('platform admin can upload when schoolId is given', async () => {
    await expect(up(seed.platform, { scope: 'school' })).resolves.toHaveProperty('id');
  });

  it.each([[4], [13]])('grade %i is VALIDATION', async (grade) => {
    await expect(up(seed.a.schoolAdmin, { grade })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('subject from another school, section in another branch, and section grade mismatch are VALIDATION', async () => {
    await expect(up(seed.a.schoolAdmin, { subjectId: seed.b.subjectId })).rejects.toMatchObject({ code: 'VALIDATION' });
    const br = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `B${n++}` });
    await expect(
      up(seed.a.schoolAdmin, { scope: 'section', kind: 'material', branchId: br.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      up(seed.a.schoolAdmin, { scope: 'section', kind: 'material', grade: 9 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      up(seed.a.schoolAdmin, { scope: 'branch', branchId: seed.b.branchId }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('validation runs before authorization', async () => {
    await expect(up(seed.a.student, { grade: 99 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects non-PDF bytes and >100 MB', async () => {
    await expect(up(seed.a.schoolAdmin, { file: { bytes: new TextEncoder().encode('%PDX-1.4'), filename: 'a.pdf' } }))
      .rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'not_pdf' } });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-'));
    await expect(up(seed.a.schoolAdmin, { file: { bytes: big, filename: 'a.pdf' } })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'too_large' },
    });
    expect(queue.jobs).toHaveLength(0);
  });

  it('if enqueue fails the item is marked failed with an error and the call rejects', async () => {
    setDepsForTest({
      blobs,
      queue: { enqueue: async () => { throw new Error('boss down'); }, hasLiveJob: async () => false },
    });
    const before = new Set((await withPlatform((tx) => tx.select({ id: contentItems.id }).from(contentItems))).map((r) => r.id));
    await expect(up(seed.a.schoolAdmin)).rejects.toThrow('boss down');
    const after = await withPlatform((tx) => tx.select().from(contentItems));
    const created = after.filter((r) => !before.has(r.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ ingestStatus: 'failed', ingestError: 'Could not queue job' });
  });
});

describe('deleteContent', () => {
  it('removes the row (cascading) and the blob; a queued job for it later no-ops', async () => {
    const { id } = await up(seed.a.schoolAdmin);
    const key = `${seed.a.schoolId}/${id}.pdf`;
    await deleteContent(seed.a.schoolAdmin, id);
    expect(await getItemOrNull(id)).toBeNull();
    await expect(blobs.get(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runIngest({ contentItemId: id, schoolId: seed.a.schoolId }, { blobs, embedder: new FakeEmbedder(), ocr: null }),
    ).resolves.toBeUndefined();
  });

  it('while processing leaves no blob and no chunks', async () => {
    const { id } = await up(seed.a.schoolAdmin);
    await seedChunks(id, [{ title: 'Ch', texts: ['alpha beta', 'gamma delta'] }]);
    await withPlatform((tx) => tx.update(contentItems).set({ ingestStatus: 'processing' }).where(eq(contentItems.id, id)));
    await deleteContent(seed.a.schoolAdmin, id);
    await expect(blobs.get(`${seed.a.schoolId}/${id}.pdf`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await withPlatform((tx) => tx.select().from(chunks).where(eq(chunks.contentItemId, id)))).toHaveLength(0);
  });

  it('authz mirrors upload; other-school and unknown items are NOT_FOUND', async () => {
    const school = await up(seed.a.schoolAdmin, { scope: 'school' });
    const branch = await up(seed.a.schoolAdmin, { scope: 'branch' });
    const mat = await up(seed.a.teacher, { scope: 'section', kind: 'material' });
    await expect(deleteContent(seed.a.branchAdmin, school.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteContent(seed.a.teacher, branch.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteContent(seed.a.student, mat.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteContent(seed.b.schoolAdmin, school.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteContent(seed.a.schoolAdmin, crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteContent(seed.a.schoolAdmin, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteContent(seed.a.teacher, mat.id)).resolves.toBeUndefined();
    await expect(deleteContent(seed.a.branchAdmin, branch.id)).resolves.toBeUndefined();
  });
});

describe('retryIngest', () => {
  it('only from failed: sets queued, clears error, enqueues; other statuses are VALIDATION', async () => {
    const { id } = await up(seed.a.schoolAdmin);
    queue.jobs.length = 0;
    await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
    await withPlatform((tx) =>
      tx.update(contentItems).set({ ingestStatus: 'failed', ingestError: 'boom' }).where(eq(contentItems.id, id)),
    );
    await expect(retryIngest(seed.a.branchAdmin, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(retryIngest(seed.b.schoolAdmin, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await retryIngest(seed.a.schoolAdmin, id);
    expect(await getItem(id)).toMatchObject({ ingestStatus: 'queued', ingestError: null });
    expect(queue.jobs).toEqual([{ contentItemId: id, schoolId: seed.a.schoolId }]);
    for (const status of ['processing', 'ready']) {
      await withPlatform((tx) => tx.update(contentItems).set({ ingestStatus: status }).where(eq(contentItems.id, id)));
      await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
});

describe('retryIngest recovery of stuck items', () => {
  const age = (id: string, minutes: number) =>
    withPlatform((tx) =>
      tx
        .update(contentItems)
        .set({ updatedAt: new Date(Date.now() - minutes * 60_000) })
        .where(eq(contentItems.id, id)),
    );
  const setStatus = (id: string, ingestStatus: string) =>
    withPlatform((tx) => tx.update(contentItems).set({ ingestStatus }).where(eq(contentItems.id, id)));

  it('a queued/processing item older than 15 min with no live job can be retried', async () => {
    for (const status of ['queued', 'processing']) {
      const { id } = await up(seed.a.schoolAdmin);
      queue.jobs.length = 0; // the job was lost
      await setStatus(id, status);
      await age(id, 16);
      await retryIngest(seed.a.schoolAdmin, id);
      expect(await getItem(id)).toMatchObject({ ingestStatus: 'queued', ingestError: null });
      expect(queue.jobs).toEqual([{ contentItemId: id, schoolId: seed.a.schoolId }]);
    }
  });

  it('measures staleness from updatedAt: an old upload that was just re-queued is refused', async () => {
    const { id } = await up(seed.a.schoolAdmin);
    queue.jobs.length = 0;
    await withPlatform((tx) =>
      tx
        .update(contentItems)
        .set({ createdAt: new Date(Date.now() - 999 * 60_000), updatedAt: new Date() })
        .where(eq(contentItems.id, id)),
    );
    await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
    await age(id, 16);
    await retryIngest(seed.a.schoolAdmin, id);
    // The re-queue bumped updatedAt, so it is not retryable again right away.
    queue.jobs.length = 0;
    await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('is refused while a job is live, or while the item is younger than 15 min', async () => {
    const { id } = await up(seed.a.schoolAdmin); // upload enqueued a job
    await age(id, 16);
    await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
    queue.jobs.length = 0;
    await age(id, 5);
    await expect(retryIngest(seed.a.schoolAdmin, id)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(queue.jobs).toHaveLength(0);
  });
});

describe('setExclusion', () => {
  const rows = (itemId: string) =>
    withPlatform((tx) => tx.select().from(contentExclusions).where(eq(contentExclusions.contentItemId, itemId)));

  it('branch_admin can hide a school item for own branch, idempotently; unhide removes the row', async () => {
    const { id } = await seedItem(seed.a, { scope: 'school' });
    const input = { branchId: seed.a.branchId, contentItemId: id };
    await setExclusion(seed.a.branchAdmin, { ...input, excluded: true });
    await setExclusion(seed.a.branchAdmin, { ...input, excluded: true });
    expect(await rows(id)).toHaveLength(1);
    await setExclusion(seed.a.branchAdmin, { ...input, excluded: false });
    await setExclusion(seed.a.branchAdmin, { ...input, excluded: false });
    expect(await rows(id)).toHaveLength(0);
  });

  it('rejects branch/section-scope items (VALIDATION) and other branches (FORBIDDEN)', async () => {
    const br = await seedItem(seed.a, { scope: 'branch', branchId: seed.a.branchId });
    const sec = await seedItem(seed.a, { scope: 'section', branchId: seed.a.branchId, sectionId: seed.a.sectionId });
    for (const it of [br, sec]) {
      await expect(
        setExclusion(seed.a.branchAdmin, { branchId: seed.a.branchId, contentItemId: it.id, excluded: true }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    const school = await seedItem(seed.a, { scope: 'school' });
    const other = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `B${n++}` });
    await expect(
      setExclusion(seed.a.branchAdmin, { branchId: other.id, contentItemId: school.id, excluded: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setExclusion(seed.a.teacher, { branchId: seed.a.branchId, contentItemId: school.id, excluded: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setExclusion(seed.a.schoolAdmin, { branchId: seed.b.branchId, contentItemId: school.id, excluded: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      setExclusion(seed.b.schoolAdmin, { branchId: seed.b.branchId, contentItemId: school.id, excluded: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listContent', () => {
  let ids: Record<string, string>;
  let otherBranchId: string;
  let teacherB: Actor;

  beforeAll(async () => {
    await resetDb();
    seed = await seedTwoSchools();
    const br = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Other branch' });
    otherBranchId = br.id;
    const sub2 = await createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Physics' });
    teacherB = await newTeacher(seed.a);
    const mk = async (k: string, o: Parameters<typeof seedItem>[1]) => [k, (await seedItem(seed.a, o)).id] as const;
    ids = Object.fromEntries([
      await mk('school8', { scope: 'school', grade: 8, title: 'school8' }),
      await mk('school9', { scope: 'school', grade: 9, title: 'school9', subjectId: sub2.id }),
      await mk('branch8', { scope: 'branch', branchId: seed.a.branchId, grade: 8, title: 'branch8' }),
      await mk('branch9', { scope: 'branch', branchId: seed.a.branchId, grade: 9, title: 'branch9' }),
      await mk('otherBranch8', { scope: 'branch', branchId: otherBranchId, grade: 8, title: 'otherBranch8' }),
      await mk('section8', {
        scope: 'section', branchId: seed.a.branchId, sectionId: seed.a.sectionId, grade: 8, title: 'section8', kind: 'material',
      }),
      await mk('own9', {
        scope: 'section', branchId: seed.a.branchId, sectionId: seed.a.sectionId, grade: 9, title: 'own9',
        kind: 'material', uploadedBy: seed.a.teacher.userId!,
      }),
    ]);
    await seedItem(seed.b, { scope: 'school', title: 'bItem' });
    await withPlatform((tx) =>
      tx.insert(contentExclusions).values({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, contentItemId: ids.school8 }),
    );
  });

  const titles = async (actor: Actor, f = {}) => (await listContent(actor, f)).map((r) => r.title).sort();

  it('school_admin sees all of own school only', async () => {
    expect(await titles(seed.a.schoolAdmin)).toEqual(
      ['branch8', 'branch9', 'otherBranch8', 'own9', 'school8', 'school9', 'section8'],
    );
  });
  it('platform admin sees every school', async () => {
    expect(await titles(seed.platform)).toContain('bItem');
  });
  it('branch_admin sees school items plus own-branch items', async () => {
    expect(await titles(seed.a.branchAdmin)).toEqual(['branch8', 'branch9', 'own9', 'school8', 'school9', 'section8']);
  });
  it('teacher sees own uploads plus school/branch items for assigned grades only', async () => {
    expect(await titles(seed.a.teacher)).toEqual(['branch8', 'own9', 'school8']);
    expect(await titles(teacherB)).toEqual([]);
  });
  it('student is FORBIDDEN', async () => {
    await expect(listContent(seed.a.student, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('filters by branchId, grade, subjectId and reports excludedBranchIds', async () => {
    expect(await titles(seed.a.schoolAdmin, { branchId: otherBranchId })).toEqual(['otherBranch8', 'school8', 'school9']);
    expect(await titles(seed.a.schoolAdmin, { grade: 9 })).toEqual(['branch9', 'own9', 'school9']);
    expect(await titles(seed.a.schoolAdmin, { subjectId: seed.a.subjectId, grade: 9 })).toEqual(['branch9', 'own9']);
    const rows = await listContent(seed.a.schoolAdmin, {});
    const s8 = rows.find((r) => r.title === 'school8')!;
    expect(s8).toMatchObject({ excludedBranchIds: [seed.a.branchId], status: 'ready', subjectName: 'Mathematics', scope: 'school' });
    expect(rows.find((r) => r.title === 'school9')!.excludedBranchIds).toEqual([]);
  });
});

describe('actors without a branch', () => {
  it('list and upload targets never raise a uuid cast error', async () => {
    const { id } = await seedItem(seed.a, { scope: 'school' });
    const ids = async (actor: Actor, f: { branchId?: string } = {}) => (await listContent(actor, f)).map((r) => r.id);
    const noBranch = (a: Actor): Actor => ({ ...a, branchId: null });
    expect(await ids(noBranch(seed.a.branchAdmin))).toContain(id);
    expect(await ids(noBranch(seed.a.teacher), { branchId: seed.a.branchId })).toContain(id);
    expect((await listUploadTargets(noBranch(seed.a.branchAdmin))).branches).toEqual([]);
    expect(await ids(seed.a.schoolAdmin, { branchId: seed.a.branchId })).toContain(id);
    expect(await ids(seed.platform, { branchId: seed.a.branchId })).toContain(id);
  });
});

describe('listUploadTargets', () => {
  it('teacher gets only assigned sections and subjects', async () => {
    const t = await newTeacher(seed.a);
    const sub = await createSubject(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `Art${n++}` });
    const sec2 = await createSection(seed.a.schoolAdmin, { branchId: seed.a.branchId, grade: 9, name: `9-${n++}` });
    await assignTeacher(seed.a.schoolAdmin, { teacherId: t.userId, sectionId: sec2.id, subjectId: sub.id });
    const targets = await listUploadTargets(t);
    expect(targets.sections.map((s) => s.id)).toEqual([sec2.id]);
    expect(targets.subjects.map((s) => s.id)).toEqual([sub.id]);
    expect(targets.assignments).toEqual([{ sectionId: sec2.id, subjectId: sub.id }]);
    expect(targets.branches.map((b) => b.id)).toEqual([seed.a.branchId]);
  });
  it('branch_admin gets own branch only; school_admin gets all; student FORBIDDEN', async () => {
    const other = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: `B${n++}` });
    const ba = await listUploadTargets(seed.a.branchAdmin);
    expect(ba.branches.map((b) => b.id)).toEqual([seed.a.branchId]);
    const sa = await listUploadTargets(seed.a.schoolAdmin);
    expect(sa.branches.map((b) => b.id)).toContain(other.id);
    expect(sa.subjects.length).toBeGreaterThan(0);
    await expect(listUploadTargets(seed.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('tenancy listSubjects', () => {
  it('staff see own school subjects, platform sees all, student FORBIDDEN', async () => {
    const own = await listSubjects(seed.a.teacher);
    expect(own.map((s) => s.id)).toContain(seed.a.subjectId);
    expect(own.map((s) => s.id)).not.toContain(seed.b.subjectId);
    const all = (await listSubjects(seed.platform)).map((s) => s.id);
    expect(all).toEqual(expect.arrayContaining([seed.a.subjectId, seed.b.subjectId]));
    await expect(listSubjects(seed.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
