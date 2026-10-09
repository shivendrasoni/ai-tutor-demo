/** Same-origin JSON fetch helpers for the public pages. Never logs request bodies (they may hold passwords). */

export type ApiError = {
  status: number;
  code: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function apiFetch<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<ApiResult<T>> {
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
    payload = await res.json();
  } catch {
    // Non-JSON body: handled below by status alone.
  }
  if (res.ok) return { ok: true, data: payload as T };
  const err = (payload as { error?: Partial<ApiError> } | null)?.error;
  return {
    ok: false,
    error: { status: res.status, code: err?.code ?? 'INTERNAL', message: err?.message, details: err?.details },
  };
}

export type Plan = { id: string; name: string; interval: 'monthly' | 'annual'; priceMinor: number; currency: string };

export function formatPrice(priceMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(priceMinor / 100);
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currency}`;
  }
}

export function intervalLabel(interval: string): string {
  if (interval === 'monthly') return 'per month';
  if (interval === 'annual') return 'per year';
  return interval;
}

export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";
export const SIGNUP_SUCCESS = "Account created. You'll be able to log in once your payment is confirmed.";

/** Messages for errors shared by the join and invite forms. */
export function credentialError(e: ApiError): string {
  switch (e.code) {
    case 'NETWORK':
      return NETWORK_ERROR;
    case 'USERNAME_TAKEN':
      return 'That username is already taken. Pick one of the suggestions or try another.';
    case 'INVALID_USERNAME':
      return 'Usernames must be 4–32 characters and use only a–z, 0–9, _ or .';
    case 'WEAK_PASSWORD':
      return 'Password must be 8 to 128 characters.';
    case 'VALIDATION':
      return 'Some details are missing or invalid. Please check the form and try again.';
    default:
      return GENERIC_ERROR;
  }
}

export function suggestionsOf(e: ApiError): string[] {
  const s = e.details?.suggestions;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [];
}
