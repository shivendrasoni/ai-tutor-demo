import type { ApiResult } from './api';

export const USERNAME_RULES_HINT = 'Letters, numbers, _ or . (4–32 characters). Not case-sensitive.';

export type UsernameCheck = { username: string; available: boolean; suggestions: string[] };

/** What the field shows after an availability check. Other failures stay silent: submit re-validates. */
export function usernameCheckOutcome(r: ApiResult<UsernameCheck>): { hint: string; suggestions: string[] } {
  if (r.ok) {
    return r.data.available
      ? { hint: `${r.data.username} is available.`, suggestions: [] }
      : { hint: `${r.data.username} is taken.`, suggestions: r.data.suggestions };
  }
  if (r.error.code === 'INVALID_USERNAME') return { hint: USERNAME_RULES_HINT, suggestions: [] };
  return { hint: '', suggestions: [] };
}
