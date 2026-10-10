import { inArray } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { users } from '@/db/schema';
import { DomainError } from '@/lib/errors';

const USERNAME_RE = /^[a-z0-9_.]{4,32}$/;
const MAX_BASE_LENGTH = 29; // leaves room for a 3-digit suffix within the 32-character limit
const MAX_SUFFIX = 999;

export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function assertValidUsername(u: string): void {
  if (typeof u !== 'string' || !USERNAME_RE.test(u)) {
    throw new DomainError(
      'INVALID_USERNAME',
      'Username must be 4-32 characters: lowercase letters, digits, "_" or "."',
    );
  }
}

/** The first `count` free names from `base1`, `base2`, ... (base normalized and cut to 29 characters). */
export async function suggestUsernames(tx: Tx, base: string, count = 3): Promise<string[]> {
  const stem = normalizeUsername(base).slice(0, MAX_BASE_LENGTH);
  const out: string[] = [];
  const batch = count + 10;
  for (let start = 1; start <= MAX_SUFFIX && out.length < count; start += batch) {
    const candidates: string[] = [];
    for (let i = start; i < start + batch && i <= MAX_SUFFIX; i++) candidates.push(`${stem}${i}`);
    const taken = new Set(
      (await tx.select({ username: users.username }).from(users).where(inArray(users.username, candidates))).map(
        (r) => r.username,
      ),
    );
    for (const c of candidates) {
      if (out.length >= count) break;
      if (!taken.has(c)) out.push(c);
    }
  }
  return out;
}
