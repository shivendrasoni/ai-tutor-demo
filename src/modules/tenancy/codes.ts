import { randomInt } from 'node:crypto';

/** Unambiguous: no I, O, 0 or 1. */
export const BRANCH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BRANCH_CODE_LENGTH = 8;

export function generateBranchCode(): string {
  let out = '';
  for (let i = 0; i < BRANCH_CODE_LENGTH; i++) out += BRANCH_CODE_ALPHABET[randomInt(BRANCH_CODE_ALPHABET.length)];
  return out;
}

/** Trims and upper-cases user input. */
export function normalizeBranchCode(raw: string): string {
  return String(raw ?? '').trim().toUpperCase();
}
