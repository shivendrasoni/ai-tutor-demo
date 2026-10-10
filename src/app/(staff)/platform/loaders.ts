import { DomainError } from '@/lib/errors';
import { costSummary, getFlaggedConversation, listFlagged, listSchools, platformOverview, routingStats } from '@/modules/analytics';
import { listActivePlans, listPendingSubscriptions } from '@/modules/enrollment';
import { requirePlatform, type Actor } from '@/modules/tenancy';

export { buildPaymentBody, paymentFormDefaults, toMajor, type PaymentForm } from './payment';

export type DaysQuery = { days?: string };
export type FlagsQuery = { status?: string };

export function parseDays(raw: string | undefined): 7 | 30 {
  if (raw === undefined || raw === '') return 7;
  if (raw === '7') return 7;
  if (raw === '30') return 30;
  throw new DomainError('VALIDATION', 'days must be 7 or 30');
}

export function parseFlagStatus(raw: string | undefined): 'open' | 'reviewed' {
  if (raw === undefined || raw === '') return 'open';
  if (raw === 'open' || raw === 'reviewed') return raw;
  throw new DomainError('VALIDATION', 'status must be open or reviewed');
}

// Every loader gates on platform first (the services re-check); `q` is accepted for a uniform (actor, q) shape.
export const loadOverview = (actor: Actor, _q: Record<string, never> = {}) => platformOverview(actor);
export const loadPayments = (actor: Actor, _q: Record<string, never> = {}) => listPendingSubscriptions(actor);
export const loadSchools = (actor: Actor, _q: Record<string, never> = {}) => listSchools(actor);
export async function loadPlans(actor: Actor, _q: Record<string, never> = {}) {
  requirePlatform(actor);
  return listActivePlans();
}
export const loadFlags = async (actor: Actor, q: FlagsQuery = {}) => {
  requirePlatform(actor);
  return listFlagged(actor, { status: parseFlagStatus(q.status) });
};
export const loadFlagged = (actor: Actor, messageId: string) => getFlaggedConversation(actor, messageId);
export const loadCosts = async (actor: Actor, q: DaysQuery = {}) => {
  requirePlatform(actor);
  return costSummary(actor, { days: parseDays(q.days) });
};
export const loadRouting = async (actor: Actor, q: DaysQuery = {}) => {
  requirePlatform(actor);
  return routingStats(actor, { days: parseDays(q.days) });
};
