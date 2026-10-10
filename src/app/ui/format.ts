import { DomainError } from '@/lib/errors';

const INT4_MAX = 2147483647;

/** Parse a major-unit money string ("499", "499.9", "499.90") into exact integer minor units. No float math. */
export function toMinor(input: string): number {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new DomainError('VALIDATION', 'Enter an amount with at most 2 decimals');
  const [whole, frac = ''] = s.split('.');
  const minor = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  if (minor > BigInt(INT4_MAX)) throw new DomainError('VALIDATION', 'Amount is too large');
  return Number(minor);
}

export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function pct(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}

export function formatDate(d: Date | null): string {
  return d === null ? '—' : d.toISOString().slice(0, 10);
}
