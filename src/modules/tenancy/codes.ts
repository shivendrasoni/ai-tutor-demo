import { randomInt } from 'node:crypto';

/** No 0/O, 1/I: easy to read aloud and type. */
export const BRANCH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const BRANCH_CODE_LENGTH = 8;

export function generateBranchCode(): string {
  let out = '';
  for (let i = 0; i < BRANCH_CODE_LENGTH; i++) out += BRANCH_CODE_ALPHABET[randomInt(BRANCH_CODE_ALPHABET.length)];
  return out;
}

export function normalizeBranchCode(raw: string): string {
  return raw.trim().toUpperCase();
}
