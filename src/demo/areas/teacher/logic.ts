/** Pure read-side helpers shared by the API handlers and the converted pages. */
import type { CoreSeed, CoreUser } from '../../core/seed-core';
import type { StoredItem, TeacherSlice } from './fixtures';

export type TeacherAssignment = { sectionId: string; sectionName: string; grade: number; subjectId: string; subjectName: string };
export type SectionProgress = {
  students: { studentId: string; name: string; chapters: { chapterId: string; ratio: number | null; attempts: number }[] }[];
  chapters: { chapterId: string; title: string; avgRatio: number | null; weak: boolean }[];
};
export type StudentUsageRow = {
  studentId: string; name: string; sectionName: string | null; messages7d: number; messages30d: number; lastActiveAt: Date | null;
};
export type UploadTargets = {
  branches: { id: string; name: string }[];
  sections: { id: string; branchId: string; grade: number; name: string }[];
  subjects: { id: string; name: string }[];
  assignments: { sectionId: string; subjectId: string }[];
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function teacherAssignments(core: CoreSeed, t: TeacherSlice, teacherId: string): TeacherAssignment[] {
  return t.assignments
    .filter((a) => a.teacherId === teacherId)
    .flatMap((a) => {
      const sec = core.sections.find((s) => s.id === a.sectionId);
      const sub = core.subjects.find((s) => s.id === a.subjectId);
      return sec && sub ? [{ sectionId: sec.id, sectionName: sec.name, grade: sec.grade, subjectId: sub.id, subjectName: sub.name }] : [];
    })
    .sort((x, y) => x.grade - y.grade || x.sectionName.localeCompare(y.sectionName) || x.subjectName.localeCompare(y.subjectName));
}

/** Students in a section that count for teacher views (everyone except removed). */
export const roster = (core: CoreSeed, sectionId: string): CoreUser[] =>
  core.users.filter((u) => u.role === 'student' && u.sectionId === sectionId && u.status !== 'removed').sort(byName);

export function sectionProgress(core: CoreSeed, t: TeacherSlice, sectionId: string, subjectId: string): SectionProgress {
  const sec = core.sections.find((s) => s.id === sectionId);
  const list = sec ? (t.chapters[`${sec.grade}:${subjectId}`] ?? []) : [];
  const students = roster(core, sectionId).map((u) => ({
    studentId: u.id,
    name: u.name,
    chapters: list.map((c) => {
      const p = t.progress[u.id]?.[c.id];
      return { chapterId: c.id, ratio: p ? p.ratio : null, attempts: p?.attempts ?? 0 };
    }),
  }));
  const chapters = list.map((c, i) => {
    const vals = students.map((s) => s.chapters[i]!.ratio).filter((r): r is number => r !== null);
    const avgRatio = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { chapterId: c.id, title: c.title, avgRatio, weak: avgRatio !== null && avgRatio < 0.5 };
  });
  return { students, chapters };
}

export function studentUsage(core: CoreSeed, t: TeacherSlice, sectionId: string, now = Date.now()): StudentUsageRow[] {
  const sec = core.sections.find((s) => s.id === sectionId);
  return roster(core, sectionId).map((u) => {
    const e = t.usage[u.id];
    return {
      studentId: u.id,
      name: u.name,
      sectionName: sec?.name ?? null,
      messages7d: e?.m7 ?? 0,
      messages30d: e?.m30 ?? 0,
      lastActiveAt: e && e.hoursAgo >= 0 ? new Date(now - e.hoursAgo * 3_600_000) : null,
    };
  });
}

export type Actor = { user: CoreUser };
const isSchoolAdmin = (u: CoreUser) => u.role === 'school_admin';

/** Content a staff member can see, mirroring `listContent` visibility. */
export function visibleContent(core: CoreSeed, t: TeacherSlice, u: CoreUser): StoredItem[] {
  let items = t.content;
  if (u.role === 'branch_admin') {
    items = items.filter((i) => i.scope === 'school' || i.branchId === u.branchId);
  } else if (u.role === 'teacher') {
    const grades = new Set(teacherAssignments(core, t, u.id).map((a) => a.grade));
    items = items.filter(
      (i) => i.uploadedBy === u.id || (grades.has(i.grade) && (i.scope === 'school' || (i.scope === 'branch' && i.branchId === u.branchId))),
    );
  } else if (!isSchoolAdmin(u)) {
    return [];
  }
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function uploadTargets(core: CoreSeed, t: TeacherSlice, u: CoreUser): UploadTargets {
  if (u.role === 'teacher') {
    const mine = t.assignments.filter((a) => a.teacherId === u.id);
    const secIds = new Set(mine.map((a) => a.sectionId));
    const subIds = new Set(mine.map((a) => a.subjectId));
    const sections = core.sections.filter((s) => secIds.has(s.id));
    const brIds = new Set(sections.map((s) => s.branchId));
    return {
      branches: core.branches.filter((b) => brIds.has(b.id)).map(({ id, name }) => ({ id, name })),
      sections: sections.map(({ id, branchId, grade, name }) => ({ id, branchId, grade, name })),
      subjects: core.subjects.filter((s) => subIds.has(s.id)),
      assignments: mine.map(({ sectionId, subjectId }) => ({ sectionId, subjectId })),
    };
  }
  const branches = core.branches.filter((b) => isSchoolAdmin(u) || b.id === u.branchId).map(({ id, name }) => ({ id, name }));
  const ids = new Set(branches.map((b) => b.id));
  const sections = core.sections.filter((s) => ids.has(s.branchId)).map(({ id, branchId, grade, name }) => ({ id, branchId, grade, name }));
  const secIds = new Set(sections.map((s) => s.id));
  const seen = new Set<string>();
  const assignments = t.assignments
    .filter((a) => secIds.has(a.sectionId))
    .map(({ sectionId, subjectId }) => ({ sectionId, subjectId }))
    .filter((a) => !seen.has(a.sectionId + a.subjectId) && seen.add(a.sectionId + a.subjectId));
  return { branches, sections, subjects: core.subjects, assignments };
}

const QUEUED_MS = 2000;
const PROCESSING_MS = 4500;

/** Moves queued -> processing -> ready by elapsed time. Returns true when anything changed (mutates `items`). */
export function advanceIngest(items: StoredItem[], now = Date.now()): boolean {
  let changed = false;
  for (const i of items) {
    const age = now - new Date(i.updatedAt).getTime();
    if (i.status === 'queued' && age >= QUEUED_MS) {
      i.status = 'processing';
      i.updatedAt = new Date(now).toISOString();
      changed = true;
    } else if (i.status === 'processing' && age >= PROCESSING_MS) {
      i.status = 'ready';
      i.pageCount = i.pageCount ?? Math.max(4, Math.round(i.sizeBytes / 90_000));
      i.updatedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}
