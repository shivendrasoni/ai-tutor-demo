import { ApiError, type Routes } from '../../core/router';
import { getPersona, getSlice, mutateSlice } from '../../core/store';
import { personaById } from '../../core/personas';
import { CORE_KEY, type CoreSeed, type CoreUser } from '../../core/seed-core';
import { buildSeed, type StoredItem, type TeacherSlice } from './fixtures';
import { advanceIngest, sectionProgress, studentUsage, teacherAssignments, visibleContent } from './logic';

export const TEACHER_KEY = 'teacher';
/** Seed slice for the teacher and content area (stored under key 'teacher'). */
export const seed: TeacherSlice = buildSeed();

const core = () => getSlice<CoreSeed>(CORE_KEY);
const slice = () => getSlice<TeacherSlice>(TEACHER_KEY);

function actor(): CoreUser {
  const id = personaById(getPersona()).userId;
  const u = id ? core().users.find((x) => x.id === id) : undefined;
  if (!u || u.role === 'student') throw new ApiError(403, 'FORBIDDEN');
  return u;
}

function assertAssigned(u: CoreUser, sectionId: string | null, subjectId: string | null) {
  if (!sectionId || !subjectId) throw new ApiError(400, 'VALIDATION', 'sectionId and subjectId are required');
  if (u.role === 'teacher') {
    if (!teacherAssignments(core(), slice(), u.id).some((a) => a.sectionId === sectionId && a.subjectId === subjectId)) {
      throw new ApiError(403, 'FORBIDDEN');
    }
  } else if (u.role === 'branch_admin') {
    if (core().sections.find((s) => s.id === sectionId)?.branchId !== u.branchId) throw new ApiError(403, 'FORBIDDEN');
  }
}

/** Visible items, after letting any in-flight ingest advance by the time elapsed. */
function listItems(u: CoreUser): StoredItem[] {
  if (slice().content.some((i) => i.status === 'queued' || i.status === 'processing')) {
    if (advanceIngest(structuredClone(slice().content))) {
      mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => void advanceIngest(d.content));
    }
  }
  return visibleContent(core(), slice(), u);
}

function canManage(u: CoreUser, i: Pick<StoredItem, 'scope' | 'branchId' | 'sectionId' | 'kind' | 'subjectId'>): boolean {
  if (u.role === 'school_admin') return true;
  if (i.scope === 'school') return false;
  if (u.role === 'branch_admin') return i.branchId === u.branchId;
  return (
    u.role === 'teacher' && i.scope === 'section' && i.kind === 'material' &&
    slice().assignments.some((a) => a.teacherId === u.id && a.sectionId === i.sectionId && a.subjectId === i.subjectId)
  );
}

const findItem = (id: string) => {
  const item = slice().content.find((i) => i.id === id);
  if (!item) throw new ApiError(404, 'NOT_FOUND', 'Content not found');
  return item;
};

export const routes: Routes = {
  'GET /api/teacher/progress': ({ query }) => {
    const u = actor();
    const sectionId = query.get('sectionId');
    const subjectId = query.get('subjectId');
    assertAssigned(u, sectionId, subjectId);
    return { progress: sectionProgress(core(), slice(), sectionId!, subjectId!) };
  },

  'GET /api/teacher/usage': ({ query }) => {
    const u = actor();
    const sectionId = query.get('sectionId');
    const subjectId = query.get('subjectId');
    assertAssigned(u, sectionId, subjectId);
    return { usage: studentUsage(core(), slice(), sectionId!) };
  },

  'GET /api/content': ({ query }) => {
    let items = listItems(actor());
    const branchId = query.get('branchId');
    const grade = query.get('grade');
    const subjectId = query.get('subjectId');
    if (branchId) items = items.filter((i) => i.scope === 'school' || i.branchId === branchId);
    if (grade) items = items.filter((i) => i.grade === Number(grade));
    if (subjectId) items = items.filter((i) => i.subjectId === subjectId);
    return items;
  },

  'POST /api/content': ({ form }) => {
    const u = actor();
    const file = form?.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'VALIDATION', 'A file is required');
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new ApiError(400, 'VALIDATION', 'Only PDF files are accepted');
    const str = (k: string) => {
      const v = form?.get(k);
      return typeof v === 'string' && v !== '' ? v : null;
    };
    const title = (str('title') ?? '').trim();
    if (!title || title.length > 200) throw new ApiError(400, 'VALIDATION', 'Title is required (max 200 chars)');
    const scope = str('scope');
    const kind = str('kind');
    if (scope !== 'school' && scope !== 'branch' && scope !== 'section') throw new ApiError(400, 'VALIDATION', 'Invalid scope');
    if (kind !== 'book' && kind !== 'material') throw new ApiError(400, 'VALIDATION', 'Invalid kind');
    const grade = Number(str('grade'));
    if (!Number.isInteger(grade) || grade < 5 || grade > 12) throw new ApiError(400, 'VALIDATION', 'Grade must be between 5 and 12');
    const subject = core().subjects.find((s) => s.id === str('subjectId'));
    if (!subject) throw new ApiError(400, 'VALIDATION', 'Subject not in this school');
    let branchId: string | null = null;
    let sectionId: string | null = null;
    if (scope !== 'school') {
      branchId = core().branches.find((b) => b.id === str('branchId'))?.id ?? null;
      if (!branchId) throw new ApiError(400, 'VALIDATION', 'Branch not in this school');
    }
    if (scope === 'section') {
      const sec = core().sections.find((s) => s.id === str('sectionId') && s.branchId === branchId);
      if (!sec) throw new ApiError(400, 'VALIDATION', 'Section not in this branch');
      if (sec.grade !== grade) throw new ApiError(400, 'VALIDATION', 'Section grade does not match');
      sectionId = sec.id;
    }
    const row = { scope, kind, branchId, sectionId, subjectId: subject.id } as const;
    if (!canManage(u, row)) throw new ApiError(403, 'FORBIDDEN');
    const id = `ci-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const item: StoredItem = {
      id, schoolId: core().school.id, ...row, grade, subjectName: subject.name, title,
      status: 'queued', ingestError: null, pageCount: null, ocrPages: 0, ocrSkippedPages: 0,
      sizeBytes: file.size || 1_200_000, uploadedBy: u.id, createdAt: now, updatedAt: now, excludedBranchIds: [],
    };
    mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => void d.content.push(item));
    // queued -> processing -> ready on a timer, and again on every poll (see listItems) for reloads.
    for (const ms of [2100, 6800]) setTimeout(() => mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => void advanceIngest(d.content)), ms);
    return new Response(JSON.stringify({ id }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'DELETE /api/content/:id': ({ params }) => {
    const u = actor();
    const item = findItem(params.id!);
    if (!canManage(u, item)) throw new ApiError(403, 'FORBIDDEN');
    mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => void (d.content = d.content.filter((i) => i.id !== item.id)));
    return {};
  },

  'POST /api/content/:id/retry': ({ params }) => {
    const u = actor();
    const item = findItem(params.id!);
    if (!canManage(u, item)) throw new ApiError(403, 'FORBIDDEN');
    const stuck = (item.status === 'queued' || item.status === 'processing') && Date.now() - new Date(item.updatedAt).getTime() > 15 * 60_000;
    if (item.status !== 'failed' && !stuck) {
      throw new ApiError(400, 'VALIDATION', 'Only failed or stuck items can be retried');
    }
    mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => {
      const i = d.content.find((x) => x.id === item.id)!;
      i.status = 'queued';
      i.ingestError = null;
      i.updatedAt = new Date().toISOString();
    });
    return {};
  },

  'POST /api/content/exclusions': ({ body }) => {
    const u = actor();
    const item = findItem(String(body?.contentItemId));
    const branch = core().branches.find((b) => b.id === body?.branchId);
    if (!branch) throw new ApiError(400, 'VALIDATION', 'Branch not in this school');
    if (u.role === 'teacher' || (u.role === 'branch_admin' && u.branchId !== branch.id)) throw new ApiError(403, 'FORBIDDEN');
    if (item.scope !== 'school') throw new ApiError(400, 'VALIDATION', 'Only school-wide items can be hidden for a branch');
    mutateSlice<TeacherSlice>(TEACHER_KEY, (d) => {
      const i = d.content.find((x) => x.id === item.id)!;
      const rest = i.excludedBranchIds.filter((b) => b !== branch.id);
      i.excludedBranchIds = body?.excluded ? [...rest, branch.id] : rest;
    });
    return {};
  },
};
