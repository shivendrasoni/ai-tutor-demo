import { hash, verify } from '@node-rs/argon2';
import { DomainError } from '@/lib/errors';

// @node-rs/argon2 defaults to Algorithm.Argon2id; tests assert the "$argon2id$" prefix.
export function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

export async function verifyPassword(hashed: string, pw: string): Promise<boolean> {
  try {
    return await verify(hashed, pw);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(pw: string): void {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) {
    throw new DomainError('WEAK_PASSWORD', 'Password must be 8 to 128 characters');
  }
}
