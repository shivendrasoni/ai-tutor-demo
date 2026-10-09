import { eq } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { isUniqueViolation } from '@/db/pgerror';
import { users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { assertPasswordStrength } from './passwords';
import { assertValidUsername, normalizeUsername, suggestUsernames } from './usernames';

export const USERNAME_INDEX = 'users_username_unique';

/** Normalizes and validates a username and checks password strength. Returns the normalized username. */
export function validateCredentials(username: string, password: string): string {
  const name = normalizeUsername(typeof username === 'string' ? username : '');
  assertValidUsername(name);
  assertPasswordStrength(password);
  return name;
}

export async function isUsernameTaken(tx: Tx, username: string): Promise<boolean> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  return rows.length > 0;
}

/** Marker thrown inside a transaction when the pre-check finds the name taken. */
class UsernameTakenSignal extends Error {}

/** Throws (inside a tx) if the username exists; pair with `withUsernameTakenHandling` outside the tx. */
export async function assertUsernameFree(tx: Tx, username: string): Promise<void> {
  if (await isUsernameTaken(tx, username)) throw new UsernameTakenSignal(username);
}

/**
 * Runs `fn` (which should open its own transaction) and converts a username conflict, from the
 * pre-check or from a concurrent insert hitting the unique index (23505), into USERNAME_TAKEN.
 * Suggestions are computed in a fresh transaction because the failed one is aborted.
 */
export async function withUsernameTakenHandling<T>(username: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UsernameTakenSignal || isUniqueViolation(err, USERNAME_INDEX)) {
      const suggestions = await withPlatform((tx) => suggestUsernames(tx, username, 3));
      throw new DomainError('USERNAME_TAKEN', 'Username is already taken', { suggestions });
    }
    throw err;
  }
}
