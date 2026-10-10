import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { sessions } from '@/db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, base64url; only the SHA-256 (`hashToken`) is ever stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await withPlatform((tx) =>
    tx.insert(sessions).values({
      userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }),
  );
  return token;
}

export async function revokeUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** Deletes the single session identified by `token` (logout). No-op for unknown tokens. */
export async function revokeSession(token: string): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  await withPlatform((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
}

/** Deletes sessions that expired before `cutoff` (housekeeping; expired sessions are already unusable). */
export async function purgeExpiredSessions(cutoff: Date): Promise<number> {
  const rows = await withPlatform((tx) =>
    tx.delete(sessions).where(lt(sessions.expiresAt, cutoff)).returning({ id: sessions.id }),
  );
  return rows.length;
}
