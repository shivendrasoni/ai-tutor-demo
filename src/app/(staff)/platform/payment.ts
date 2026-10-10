import { toMinor } from '@/app/ui/format';
import { DomainError } from '@/lib/errors';

type PriceRow = { priceMinor: number; currency: string };
export type PaymentForm = { subscriptionId: string; amount: string; currency: string; reference: string; paidAt: string };

/** Minor units -> a major-unit string with exactly 2 decimals, without float math. */
export function toMajor(minor: number): string {
  const whole = Math.floor(minor / 100);
  const frac = String(minor % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

/** The form starts at the plan price in major units and today's UTC date; both stay editable. */
export function paymentFormDefaults(row: PriceRow): { amount: string; currency: string; paidAt: string } {
  return { amount: toMajor(row.priceMinor), currency: row.currency, paidAt: new Date().toISOString().slice(0, 10) };
}

/** Builds the POST /api/platform/payments body. The typed amount wins over the plan price; invalid input throws VALIDATION. */
export function buildPaymentBody(form: PaymentForm): {
  subscriptionId: string; amountMinor: number; currency: string; externalRef?: string; paidAt: string;
} {
  const amountMinor = toMinor(form.amount);
  if (amountMinor <= 0) throw new DomainError('VALIDATION', 'Amount must be greater than zero');
  const date = form.paidAt.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : new Date(NaN);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new DomainError('VALIDATION', 'Enter a valid paid-at date');
  const reference = form.reference.trim();
  return {
    subscriptionId: form.subscriptionId,
    amountMinor,
    currency: form.currency.trim().toUpperCase() || 'INR',
    ...(reference ? { externalRef: reference } : {}),
    paidAt: d.toISOString(),
  };
}
