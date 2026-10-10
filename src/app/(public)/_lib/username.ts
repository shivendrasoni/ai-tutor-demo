import type { ApiResult } from './api';

export type UsernameCheck = { username: string; available: boolean; suggestions: string[] };

export const USERNAME_RULES_HINT = 'Usernames must be 4–32 characters and use only a–z, 0–9, _ or .';

/** What the username field shows after an availability check: the hint text and the suggestion chips. */
export function usernameCheckOutcome(r: ApiResult<UsernameCheck>): { hint: string; suggestions: string[] } {
  if (!r.ok) return { hint: r.error.code === 'INVALID_USERNAME' ? USERNAME_RULES_HINT : '', suggestions: [] };
  if (r.data.available) return { hint: `${r.data.username} is available.`, suggestions: [] };
  return { hint: `${r.data.username} is taken.`, suggestions: r.data.suggestions };
}
