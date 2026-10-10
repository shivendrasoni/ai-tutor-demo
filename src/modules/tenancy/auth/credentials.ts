import { eq } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { users } from '@/db/schema';
import { isUniqueViolation } from '@/db/pgerror';
import { DomainError } from '@/lib/errors';
import { assertPasswordStrength } from './passwords';
import { assertValidUsername, normalizeUsername, suggestUsernames } from './usernames';

/** Normalizes the username, validates it and the password; returns the normalized username. */
export function validateCredentials(rawUsername: string, password: string): string {
  const username = normalizeUsername(rawUsername);
  assertValidUsername(username);
  assertPasswordStrength(password);
  return username;
}

export async function isUsernameTaken(tx: Tx, username: string): Promise<boolean> {
  const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  return !!row;
}

export async function assertUsernameFree(tx: Tx, username: string): Promise<void> {
  if (await isUsernameTaken(tx, username)) {
    throw new DomainError('USERNAME_TAKEN', 'That username is taken', {
      suggestions: await suggestUsernames(tx, username, 3),
    });
  }
}

/** Runs `fn`; a unique violation on the username index (a concurrent signup race) becomes USERNAME_TAKEN. */
export async function withUsernameTakenHandling<T>(username: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err, 'users_username_unique')) {
      // The failed transaction is gone; look the suggestions up in a fresh one.
      const suggestions = await withPlatform((tx) => suggestUsernames(tx, username, 3));
      throw new DomainError('USERNAME_TAKEN', 'That username is taken', { suggestions });
    }
    throw err;
  }
}
