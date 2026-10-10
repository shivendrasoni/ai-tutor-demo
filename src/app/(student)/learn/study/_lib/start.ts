import { studyFetch, type ApiError, type Artifact } from './api';

export type TakeStart =
  | { ok: true; art: Artifact; attemptId: string; deadline: string | null; answers: Record<string, number | string> }
  | { ok: false; error: ApiError };

/**
 * Loads the test and starts (or resumes) the attempt. The start response carries the attempt's saved answers, so there is
 * no second fetch that could fail and leave an empty answer map to be autosaved over real answers. Any failure is fatal:
 * no attempt id is returned, so the page never enables autosave.
 */
export async function startTake(id: string): Promise<TakeStart> {
  const [a, s] = await Promise.all([
    studyFetch<Artifact>(`/api/study/artifacts/${id}`),
    studyFetch<{ attemptId: string; deadline: string | null; answers?: Record<string, number | string> }>(`/api/study/artifacts/${id}/attempts`, { method: 'POST' }),
  ]);
  if (!a.ok) return { ok: false, error: a.error };
  if (!s.ok) return { ok: false, error: s.error };
  return { ok: true, art: a.data, attemptId: s.data.attemptId, deadline: s.data.deadline, answers: { ...(s.data.answers ?? {}) } };
}
