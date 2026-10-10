import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { sessions } from '@/db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 bytes from the OS CSPRNG, base64url (43 characters). */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** Only this SHA-256 hex digest is ever stored; the raw token lives in the cookie alone. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await withPlatform((tx) =>
    tx.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }),
  );
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await withPlatform((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
}

export async function revokeUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** Deletes sessions that expired before `cutoff`; returns how many were removed. */
export async function purgeExpiredSessions(cutoff: Date): Promise<number> {
  const rows = await withPlatform((tx) =>
    tx.delete(sessions).where(lt(sessions.expiresAt, cutoff)).returning({ id: sessions.id }),
  );
  return rows.length;
}
