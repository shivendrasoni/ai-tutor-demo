import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { isRemovedStudent, loadActor, type Actor } from '../actor';
import { hashPassword, verifyPassword } from './passwords';
import { createSession } from './sessions';
import { normalizeUsername } from './usernames';

// Verified against when the user is unknown or has no password, so those paths cost the same argon2 work as a
// wrong password (no timing oracle for which usernames exist). Computed once, lazily.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`));

function invalid(): DomainError {
  return new DomainError('INVALID_CREDENTIALS', 'Wrong username or password');
}

export async function login(username: string, password: string): Promise<{ token: string; actor: Actor }> {
  const name = normalizeUsername(typeof username === 'string' ? username : '');
  const pw = typeof password === 'string' ? password : '';

  // Look the user up first and run argon2 outside any transaction (no pooled connection held during the hash).
  const [user] = await withPlatform((tx) =>
    tx.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.username, name)).limit(1),
  );
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), pw);
  if (!user || !user.passwordHash || !ok) throw invalid();

  const actor = await withPlatform(async (tx) => {
    // Only reached with a correct password, so account state is not revealed to guessers.
    if (await isRemovedStudent(tx, user.id)) throw new DomainError('ACCOUNT_REMOVED', 'This account has been removed');
    const loaded = await loadActor(tx, user.id);
    if (!loaded) throw invalid();
    return loaded;
  });

  return { token: await createSession(actor.userId), actor };
}
