import type { Citation } from './format';

export type { Citation };
export type ApiError = { status: number; code: string; message?: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Same-origin JSON fetch (GET/POST/PUT). A 204 yields `data: null`. */
export async function studyFetch<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin', cache: 'no-store' };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: { status: 0, code: 'NETWORK' } };
  }
  let payload: unknown = null;
  try {
    payload = res.status === 204 ? null : await res.json();
  } catch {
    // non-JSON body: fall through on status alone
  }
  if (res.ok) return { ok: true, data: payload as T };
  const err = (payload as { error?: Partial<ApiError> } | null)?.error;
  return { ok: false, error: { status: res.status, code: err?.code ?? 'INTERNAL', message: err?.message } };
}

export type ArtifactType = 'practice_test' | 'mock_exam' | 'study_notes' | 'last_night_notes';
export type Subject = { id: string; name: string };
export type Chapter = { id: string; title: string; itemTitle: string; ordinal: number };
export type Pattern = { key: string; name: string; durationMinutes: number };
export type Summary = {
  id: string; type: ArtifactType; status: string; title: string | null; createdAt: string; attemptCount: number; bestScorePct: number | null;
};
export type ViewQuestion = { id: string; type: string; prompt: string; options?: string[]; marks: number; chapterId: string; citations: Citation[] };
export type ViewSection = { key: string; title: string; questions: ViewQuestion[] };
export type ViewNote = { heading: string; bodyMarkdown: string; chapterId: string; citations: Citation[] };
export type Artifact = {
  id: string; type: ArtifactType; status: string; error: string | null; chapterTitles: Record<string, string>;
  title: string | null; durationMinutes?: number; sections?: ViewSection[]; questions?: ViewQuestion[]; notes?: ViewNote[];
};
export type QResult = { score: number; maxScore: number; feedback?: string; correct?: boolean; needsReview?: true };
export type ReviewQuestion = ViewQuestion & { correctIndex?: number; modelAnswer?: string; rubric?: string[] };
export type Attempt = {
  id: string; artifactId: string; status: string; deadline: string | null; submittedAt: string | null;
  answers: Record<string, number | string>; artifact: Artifact;
  results?: Record<string, QResult>; score?: number; maxScore?: number;
  byChapter?: Record<string, { scored: number; max: number }>; questions?: ReviewQuestion[];
};

export const allQuestions = (a: Artifact): ViewQuestion[] => a.questions ?? a.sections?.flatMap((s) => s.questions) ?? [];

/** Where to send the student for an auth failure, or null. */
export function authRedirect(e: ApiError): string | null {
  return e.status === 401 ? '/login' : e.status === 403 ? '/status' : null;
}
