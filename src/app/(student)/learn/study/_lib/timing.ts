export const POLL_MS = 2000;
export const AUTOSAVE_MS = 10_000;

/** Whole seconds until `deadline` (ISO string), never below 0. */
export function secondsLeft(deadline: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - nowMs) / 1000));
}

/** True when there are unsaved answers and at least 10 s have passed since the last save. */
export function shouldAutosave(lastSavedAt: number, dirty: boolean, nowMs: number): boolean {
  return dirty && nowMs - lastSavedAt >= AUTOSAVE_MS;
}

/** Poll every 2 s while an artifact is generating, otherwise stop. */
export function nextPollDelay(status: string): number | null {
  return status === 'generating' ? POLL_MS : null;
}

/** `h:mm:ss` */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const GRACE_MS = 2 * 60_000;

/** The take link resumes an `in_progress` attempt that is still within deadline + grace; otherwise it starts a new one. */
export function takeLinkLabel(status: string, deadline: string | null, nowMs: number): 'Resume attempt' | 'Start a new attempt' {
  const resumable = status === 'in_progress' && (deadline === null || nowMs <= Date.parse(deadline) + GRACE_MS);
  return resumable ? 'Resume attempt' : 'Start a new attempt';
}
