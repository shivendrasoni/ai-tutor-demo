import { genericMessage, GENERIC_ERROR, type ApiResult } from '../_lib/api';

export type Me = { name: string; roles: string[]; isPlatformAdmin: boolean };
export type StatusInfo = { status: string; planName: string | null; periodEnd: string | null };

export type StatusOutcome =
  | { kind: 'redirect'; to: string }
  | { kind: 'text'; text: string }
  | { kind: 'need-status' }
  | { kind: 'error'; message: string };

export const PENDING_COPY =
  "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.";
export const LAPSED_COPY = 'Your plan has expired. Please contact us to renew.';

/**
 * Two-phase: call with /api/me first. Students return 'need-status'; call again with the /api/me/status
 * result to get the final outcome.
 */
export function resolveStatus(me: ApiResult<Me>, status?: ApiResult<StatusInfo>): StatusOutcome {
  if (!me.ok) {
    return me.error.status === 401 ? { kind: 'redirect', to: '/login' } : { kind: 'error', message: genericMessage(me.error) };
  }
  const signedIn: StatusOutcome = { kind: 'text', text: `Signed in as ${me.data.name}.` };
  if (!me.data.roles.includes('student')) return signedIn;
  if (!status) return { kind: 'need-status' };
  if (!status.ok) {
    if (status.error.status === 401) return { kind: 'redirect', to: '/login' };
    if (status.error.status === 403) return signedIn;
    return { kind: 'error', message: genericMessage(status.error) };
  }
  switch (status.data.status) {
    case 'active':
      return { kind: 'redirect', to: '/learn' };
    case 'pending_payment':
      return { kind: 'text', text: PENDING_COPY };
    case 'lapsed':
      return { kind: 'text', text: LAPSED_COPY };
    default:
      return { kind: 'error', message: GENERIC_ERROR };
  }
}
