import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { sessions } from '@/db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
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
