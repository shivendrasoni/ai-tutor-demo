export type ApiError = { status: number; code: string; message?: string; details?: Record<string, unknown> };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";
export const RATE_LIMITED_ERROR = 'Too many attempts. Please wait a few minutes and try again.';

/** Same-origin JSON fetch. A 204 yields `data: null`; a thrown fetch is `{ status: 0, code: 'NETWORK' }`. */
export async function apiFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ApiResult<T>> {
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
    // Non-JSON body: fall through on status alone.
  }
  if (res.ok) return { ok: true, data: payload as T };
  const err = (payload as { error?: Partial<ApiError> } | null)?.error;
  return {
    ok: false,
    error: { status: res.status, code: err?.code ?? 'INTERNAL', message: err?.message, details: err?.details },
  };
}

/** Friendly copy for failures that have no screen-specific meaning. */
export function genericMessage(e: ApiError): string {
  if (e.code === 'NETWORK' || e.status === 0) return NETWORK_ERROR;
  if (e.status === 429 || e.code === 'RATE_LIMITED') return RATE_LIMITED_ERROR;
  return GENERIC_ERROR;
}
