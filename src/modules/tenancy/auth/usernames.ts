import { like } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { users } from '@/db/schema';
import { DomainError } from '@/lib/errors';

const USERNAME_RE = /^[a-z0-9_.]{4,32}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertValidUsername(u: string): void {
  if (!USERNAME_RE.test(u)) {
    throw new DomainError('INVALID_USERNAME', 'Username must be 4-32 characters: a-z, 0-9, _ or .');
  }
}

/** First `count` free names among base1, base2, ... (base normalized and truncated to 29 chars). */
export async function suggestUsernames(tx: Tx, base: string, count = 3): Promise<string[]> {
  const b = normalizeUsername(base).slice(0, 29);
  const escaped = b.replace(/[\\%_]/g, '\\$&');
  const rows = await tx.select({ username: users.username }).from(users).where(like(users.username, `${escaped}%`));
  const taken = new Set(rows.map((r) => r.username));
  const out: string[] = [];
  for (let i = 1; out.length < count; i++) {
    const cand = `${b}${i}`;
    if (!taken.has(cand)) out.push(cand);
  }
  return out;
}
