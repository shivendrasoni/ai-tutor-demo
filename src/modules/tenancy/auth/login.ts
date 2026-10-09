import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { loadActor, type Actor } from '../actor';
import { hashPassword, verifyPassword } from './passwords';
import { createSession } from './sessions';
import { normalizeUsername } from './usernames';

// Fixed-cost dummy hash so unknown users cost the same argon2 verify as real ones.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

export async function login(username: string, password: string): Promise<{ token: string; actor: Actor }> {
  const name = normalizeUsername(username);
  const [user] = await withPlatform((tx) => tx.select().from(users).where(eq(users.username, name)).limit(1));

  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !user.passwordHash || !ok) throw new DomainError('INVALID_CREDENTIALS');

  // Status is checked only after the password is proven correct.
  const actor = await withPlatform(async (tx) => {
    const [sp] = await tx.select({ status: studentProfiles.status }).from(studentProfiles).where(eq(studentProfiles.userId, user.id));
    if (sp?.status === 'removed') throw new DomainError('ACCOUNT_REMOVED');
    return loadActor(tx, user.id);
  });
  if (!actor) throw new DomainError('INVALID_CREDENTIALS');
  const token = await createSession(user.id);
  return { token, actor };
}
