import { DomainError } from '@/lib/errors';
import { listTeacherAssignments, sectionProgress, studentUsage } from '@/modules/analytics';
import type { Actor } from '@/modules/tenancy';

/** Only the teacher's own section x subject pairs can be selected; the services re-check on every call. */
export async function loadTeacherDashboard(actor: Actor, q: { sectionId?: string; subjectId?: string }) {
  const assignments = await listTeacherAssignments(actor);
  const sectionId = q.sectionId || undefined;
  const subjectId = q.subjectId || undefined;
  if ((sectionId === undefined) !== (subjectId === undefined)) {
    throw new DomainError('VALIDATION', 'Choose both a section and a subject');
  }
  let selected: { sectionId: string; subjectId: string } | null = null;
  if (sectionId !== undefined && subjectId !== undefined) {
    if (!assignments.some((a) => a.sectionId === sectionId && a.subjectId === subjectId)) throw new DomainError('FORBIDDEN');
    selected = { sectionId, subjectId };
  } else if (assignments.length > 0) {
    selected = { sectionId: assignments[0].sectionId, subjectId: assignments[0].subjectId };
  }
  if (!selected) return { assignments, selected, progress: null, usage: [] as Awaited<ReturnType<typeof studentUsage>> };
  const [progress, usage] = await Promise.all([sectionProgress(actor, selected), studentUsage(actor, selected)]);
  return { assignments, selected, progress, usage };
}
