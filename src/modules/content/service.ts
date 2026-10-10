import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { type Tx } from '@/db/client';
import {
  branches,
  contentExclusions,
  contentItems,
  sections,
  subjects,
  teacherAssignments,
} from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { assertGrade, canManageBranch, canManageSchool, runAs, type Actor } from '@/modules/tenancy';
import { getDeps } from './deps';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export type IngestStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type ContentScope = 'school' | 'branch' | 'section';
export type ContentKind = 'book' | 'material';

export type ContentItemRow = {
  id: string;
  schoolId: string;
  scope: ContentScope;
  kind: ContentKind;
  grade: number;
  subjectId: string;
  subjectName: string;
  branchId: string | null;
  sectionId: string | null;
  title: string;
  status: IngestStatus;
  ingestError: string | null;
  pageCount: number | null;
  ocrPages: number;
  ocrSkippedPages: number;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
  excludedBranchIds: string[];
};

export type UploadInput = {
  scope: ContentScope;
  schoolId: string;
  branchId?: string;
  sectionId?: string;
  grade: number;
  subjectId: string;
  kind: ContentKind;
  title: string;
  file: { bytes: Uint8Array; filename: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
/** Matches no row; used instead of '' (a uuid cast error) when an actor has no branch. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const QUEUE_ERROR = 'Could not queue job';

const isStaff = (actor: Actor) => actor.roles.some((r) => r !== 'student');
const isTeacher = (actor: Actor) => actor.roles.includes('teacher');

function assertStaff(actor: Actor): void {
  if (!actor.isPlatformAdmin && !(actor.schoolId !== null && isStaff(actor))) throw new DomainError('FORBIDDEN');
}

type Target = {
  schoolId: string;
  scope: ContentScope;
  kind: ContentKind;
  branchId: string | null;
  sectionId: string | null;
  subjectId: string;
};

/** The one authorization rule for upload, delete and retry (spec §6). Throws FORBIDDEN. */
async function assertCanManageTarget(tx: Tx, actor: Actor, t: Target): Promise<void> {
  if (t.scope === 'school') {
    if (!canManageSchool(actor, t.schoolId)) throw new DomainError('FORBIDDEN');
    return;
  }
  if (t.branchId && canManageBranch(actor, t.schoolId, t.branchId)) return;
  if (t.scope === 'section' && t.kind === 'material' && t.sectionId && isTeacher(actor) && actor.schoolId === t.schoolId) {
    const [row] = await tx
      .select({ id: teacherAssignments.sectionId })
      .from(teacherAssignments)
      .where(
        and(
          eq(teacherAssignments.teacherId, actor.userId),
          eq(teacherAssignments.sectionId, t.sectionId),
          eq(teacherAssignments.subjectId, t.subjectId),
          eq(teacherAssignments.schoolId, t.schoolId),
        ),
      )
      .limit(1);
    if (row) return;
  }
  throw new DomainError('FORBIDDEN');
}

function validation(message: string, field: string): DomainError {
  return new DomainError('VALIDATION', message, { field });
}

export async function uploadContent(actor: Actor, input: UploadInput): Promise<{ id: string }> {
  const { bytes } = input.file;
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new DomainError('VALIDATION', 'File is too large (max 100 MB)', { field: 'file', reason: 'too_large' });
  }
  if (bytes.length < PDF_MAGIC.length || PDF_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new DomainError('VALIDATION', 'Only PDF files are accepted', { field: 'file', reason: 'not_pdf' });
  }
  if (!isUuid(input.schoolId) || (!actor.isPlatformAdmin && input.schoolId !== actor.schoolId)) {
    throw new DomainError('FORBIDDEN');
  }
  const { schoolId } = input;
  if (!['school', 'branch', 'section'].includes(input.scope)) throw validation('Invalid scope', 'scope');
  if (!['book', 'material'].includes(input.kind)) throw validation('Invalid kind', 'kind');
  assertGrade(input.grade);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200) throw validation('Title is required (max 200 chars)', 'title');

  const id = crypto.randomUUID();
  const fileKey = `${schoolId}/${id}.pdf`;
  const { blobs, queue } = getDeps();

  // Validate fields, then authorize; the blob is only written once both pass.
  const target = await runAs(actor, async (tx): Promise<Target> => {
    if (!isUuid(input.subjectId)) throw validation('Subject not in this school', 'subjectId');
    const [subject] = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.schoolId, schoolId)));
    if (!subject) throw validation('Subject not in this school', 'subjectId');

    let branchId: string | null = null;
    let sectionId: string | null = null;
    if (input.scope !== 'school') {
      if (!isUuid(input.branchId)) throw validation('Branch not in this school', 'branchId');
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, input.branchId), eq(branches.schoolId, schoolId)));
      if (!branch) throw validation('Branch not in this school', 'branchId');
      branchId = branch.id;
    }
    if (input.scope === 'section') {
      if (!isUuid(input.sectionId)) throw validation('Section not in this branch', 'sectionId');
      const [section] = await tx
        .select({ id: sections.id, grade: sections.grade })
        .from(sections)
        .where(
          and(eq(sections.id, input.sectionId), eq(sections.branchId, branchId!), eq(sections.schoolId, schoolId)),
        );
      if (!section) throw validation('Section not in this branch', 'sectionId');
      if (section.grade !== input.grade) throw validation('Section grade does not match', 'grade');
      sectionId = section.id;
    }
    const t: Target = { schoolId, scope: input.scope, kind: input.kind, branchId, sectionId, subjectId: input.subjectId };
    await assertCanManageTarget(tx, actor, t);
    return t;
  });

  await blobs.put(fileKey, bytes);
  try {
    await runAs(actor, (tx) =>
      tx.insert(contentItems).values({
        id,
        schoolId,
        grade: input.grade,
        subjectId: target.subjectId,
        kind: target.kind,
        scope: target.scope,
        branchId: target.branchId,
        sectionId: target.sectionId,
        title,
        fileKey,
        uploadedBy: actor.userId,
        ingestStatus: 'queued',
        sizeBytes: bytes.length,
      }),
    );
  } catch (err) {
    await blobs.delete(fileKey).catch(() => undefined);
    throw err;
  }
  try {
    await queue.enqueue({ contentItemId: id, schoolId });
  } catch (err) {
    await markQueueFailed(actor, id);
    throw err;
  }
  return { id };
}

async function markQueueFailed(actor: Actor, id: string): Promise<void> {
  await runAs(actor, (tx) =>
    tx.update(contentItems).set({ ingestStatus: 'failed', ingestError: QUEUE_ERROR }).where(eq(contentItems.id, id)),
  ).catch((e) => console.error('[content] could not mark item failed', e));
}

/** Loads an item visible to the actor (RLS hides other schools) or throws NOT_FOUND. */
async function loadItem(tx: Tx, itemId: string) {
  if (!isUuid(itemId)) throw new DomainError('NOT_FOUND', 'Content not found');
  const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId)).limit(1);
  if (!item) throw new DomainError('NOT_FOUND', 'Content not found');
  return item;
}

const targetOf = (item: typeof contentItems.$inferSelect): Target => ({
  schoolId: item.schoolId,
  scope: item.scope as ContentScope,
  kind: item.kind as ContentKind,
  branchId: item.branchId,
  sectionId: item.sectionId,
  subjectId: item.subjectId,
});

export async function deleteContent(actor: Actor, itemId: string): Promise<void> {
  const fileKey = await runAs(actor, async (tx) => {
    const item = await loadItem(tx, itemId);
    await assertCanManageTarget(tx, actor, targetOf(item));
    // Cascades to chapters, chunks and exclusions; an in-flight ingest then no-ops on its final write.
    await tx.delete(contentItems).where(eq(contentItems.id, item.id));
    return item.fileKey;
  });
  try {
    await getDeps().blobs.delete(fileKey);
  } catch (err) {
    console.error('[content] blob delete failed', fileKey, err);
  }
}

/** A queued/processing item this old with no live job lost its job (e.g. a queue was recreated); retry may re-enqueue it. */
export const STUCK_INGEST_AFTER_MS = 15 * 60_000;

/** Failed items can always be retried; queued/processing ones only when stuck (old and with no live job). */
export async function retryIngest(actor: Actor, itemId: string): Promise<void> {
  const job = await runAs(actor, async (tx) => {
    const item = await loadItem(tx, itemId);
    await assertCanManageTarget(tx, actor, targetOf(item));
    if (item.ingestStatus !== 'failed') {
      const inFlight = item.ingestStatus === 'queued' || item.ingestStatus === 'processing';
      const old = Date.now() - item.createdAt.getTime() > STUCK_INGEST_AFTER_MS;
      if (!inFlight || !old || (await getDeps().queue.hasLiveJob(item.id))) {
        throw new DomainError('VALIDATION', 'Only failed or stuck items can be retried', { field: 'status' });
      }
    }
    await tx.update(contentItems).set({ ingestStatus: 'queued', ingestError: null }).where(eq(contentItems.id, item.id));
    return { contentItemId: item.id, schoolId: item.schoolId };
  });
  try {
    await getDeps().queue.enqueue(job);
  } catch (err) {
    await markQueueFailed(actor, job.contentItemId);
    throw err;
  }
}

export async function setExclusion(
  actor: Actor,
  input: { branchId: string; contentItemId: string; excluded: boolean },
): Promise<void> {
  await runAs(actor, async (tx) => {
    const item = await loadItem(tx, input.contentItemId);
    if (!isUuid(input.branchId)) throw validation('Branch not in this school', 'branchId');
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.schoolId, item.schoolId)));
    if (!branch) throw validation('Branch not in this school', 'branchId');
    if (!canManageBranch(actor, item.schoolId, branch.id)) throw new DomainError('FORBIDDEN');
    if (item.scope !== 'school') {
      throw validation('Only school-wide items can be hidden for a branch', 'contentItemId');
    }
    if (input.excluded) {
      await tx
        .insert(contentExclusions)
        .values({ schoolId: item.schoolId, branchId: branch.id, contentItemId: item.id })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(contentExclusions)
        .where(and(eq(contentExclusions.branchId, branch.id), eq(contentExclusions.contentItemId, item.id)));
    }
  });
}

export async function listContent(
  actor: Actor,
  filter: { branchId?: string; grade?: number; subjectId?: string },
): Promise<ContentItemRow[]> {
  assertStaff(actor);
  return runAs(actor, async (tx) => {
    const where: (SQL | undefined)[] = [];
    if (!actor.isPlatformAdmin) {
      const isSchoolAdmin = actor.roles.includes('school_admin');
      if (!isSchoolAdmin && actor.roles.includes('branch_admin')) {
        where.push(or(eq(contentItems.scope, 'school'), eq(contentItems.branchId, actor.branchId ?? NIL_UUID)));
      } else if (!isSchoolAdmin) {
        // Teacher: own uploads, plus school/branch items for grades of the sections they teach.
        const grades = await tx
          .selectDistinct({ grade: sections.grade })
          .from(teacherAssignments)
          .innerJoin(sections, eq(sections.id, teacherAssignments.sectionId))
          .where(eq(teacherAssignments.teacherId, actor.userId));
        const gradeList = grades.map((g) => g.grade);
        const visible = and(
          or(
            eq(contentItems.scope, 'school'),
            and(eq(contentItems.scope, 'branch'), eq(contentItems.branchId, actor.branchId ?? NIL_UUID)),
          ),
          gradeList.length ? inArray(contentItems.grade, gradeList) : undefined,
        );
        where.push(
          or(eq(contentItems.uploadedBy, actor.userId), gradeList.length ? visible : undefined),
        );
      }
    }
    if (filter.branchId) {
      where.push(or(eq(contentItems.scope, 'school'), eq(contentItems.branchId, filter.branchId)));
    }
    if (filter.grade !== undefined) where.push(eq(contentItems.grade, filter.grade));
    if (filter.subjectId) where.push(eq(contentItems.subjectId, filter.subjectId));

    const rows = await tx
      .select({ item: contentItems, subjectName: subjects.name })
      .from(contentItems)
      .innerJoin(subjects, eq(subjects.id, contentItems.subjectId))
      .where(and(...where))
      .orderBy(desc(contentItems.createdAt), desc(contentItems.id));

    const ids = rows.map((r) => r.item.id);
    const excl = ids.length
      ? await tx
          .select({ itemId: contentExclusions.contentItemId, branchId: contentExclusions.branchId })
          .from(contentExclusions)
          .where(inArray(contentExclusions.contentItemId, ids))
      : [];
    const byItem = new Map<string, string[]>();
    for (const e of excl) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e.branchId]);

    return rows.map(({ item, subjectName }) => ({
      id: item.id,
      schoolId: item.schoolId,
      scope: item.scope as ContentScope,
      kind: item.kind as ContentKind,
      grade: item.grade,
      subjectId: item.subjectId,
      subjectName,
      branchId: item.branchId,
      sectionId: item.sectionId,
      title: item.title,
      status: item.ingestStatus as IngestStatus,
      ingestError: item.ingestError,
      pageCount: item.pageCount,
      ocrPages: item.ocrPages,
      ocrSkippedPages: item.ocrSkippedPages,
      sizeBytes: item.sizeBytes,
      uploadedBy: item.uploadedBy,
      createdAt: item.createdAt,
      excludedBranchIds: byItem.get(item.id) ?? [],
    }));
  });
}

export type UploadTargets = {
  branches: { id: string; name: string }[];
  sections: { id: string; branchId: string; grade: number; name: string }[];
  subjects: { id: string; name: string }[];
  assignments: { sectionId: string; subjectId: string }[];
};

/** Only what this actor may upload to. */
export async function listUploadTargets(actor: Actor): Promise<UploadTargets> {
  assertStaff(actor);
  return runAs(actor, async (tx) => {
    const isSchoolAdmin = actor.isPlatformAdmin || actor.roles.includes('school_admin');
    const isBranchAdmin = !isSchoolAdmin && actor.roles.includes('branch_admin');

    if (isSchoolAdmin || isBranchAdmin) {
      const branchRows = await tx
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(isBranchAdmin ? eq(branches.id, actor.branchId ?? NIL_UUID) : undefined)
        .orderBy(branches.name);
      const branchIds = branchRows.map((b) => b.id);
      const sectionRows = branchIds.length
        ? await tx
            .select({ id: sections.id, branchId: sections.branchId, grade: sections.grade, name: sections.name })
            .from(sections)
            .where(inArray(sections.branchId, branchIds))
            .orderBy(sections.grade, sections.name)
        : [];
      const subjectRows = await tx
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .orderBy(subjects.name);
      const sectionIds = sectionRows.map((s) => s.id);
      const assignments = sectionIds.length
        ? await tx
            .selectDistinct({ sectionId: teacherAssignments.sectionId, subjectId: teacherAssignments.subjectId })
            .from(teacherAssignments)
            .where(inArray(teacherAssignments.sectionId, sectionIds))
        : [];
      return { branches: branchRows, sections: sectionRows, subjects: subjectRows, assignments };
    }

    // Teacher: only assigned sections and subjects.
    const assignments = await tx
      .selectDistinct({ sectionId: teacherAssignments.sectionId, subjectId: teacherAssignments.subjectId })
      .from(teacherAssignments)
      .where(eq(teacherAssignments.teacherId, actor.userId));
    const sectionIds = [...new Set(assignments.map((a) => a.sectionId))];
    const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
    const sectionRows = sectionIds.length
      ? await tx
          .select({ id: sections.id, branchId: sections.branchId, grade: sections.grade, name: sections.name })
          .from(sections)
          .where(inArray(sections.id, sectionIds))
          .orderBy(sections.grade, sections.name)
      : [];
    const branchIds = [...new Set(sectionRows.map((s) => s.branchId))];
    const branchRows = branchIds.length
      ? await tx.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, branchIds))
      : [];
    const subjectRows = subjectIds.length
      ? await tx
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(inArray(subjects.id, subjectIds))
          .orderBy(subjects.name)
      : [];
    return { branches: branchRows, sections: sectionRows, subjects: subjectRows, assignments };
  });
}
