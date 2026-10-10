import { hash, verify } from '@node-rs/argon2';
import { DomainError } from '@/lib/errors';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/** Hashes with argon2id (the package default algorithm) and a random per-hash salt; the result is a PHC string. */
export function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

/** False for a wrong password and for a malformed or unsupported hash (never throws on bad input). */
export async function verifyPassword(passwordHash: string, pw: string): Promise<boolean> {
  try {
    return await verify(passwordHash, pw);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(pw: string): void {
  if (typeof pw !== 'string' || pw.length < MIN_LENGTH || pw.length > MAX_LENGTH) {
    throw new DomainError('WEAK_PASSWORD', `Password must be ${MIN_LENGTH}-${MAX_LENGTH} characters`);
  }
}
