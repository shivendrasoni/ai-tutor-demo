import { GENERIC_ERROR, NETWORK_ERROR, type ApiResult } from '../_lib/api';

export type Me = { name: string; roles: string[]; isPlatformAdmin: boolean };
export type StatusData = { status: string; planName: string | null; periodEnd: string | null };
export type Resolved =
  | { kind: 'redirect'; to: '/login' | '/learn' }
  | { kind: 'need-status' }
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string };

const COPY: Record<string, string> = {
  pending_payment:
    "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.",
  lapsed: 'Your plan has expired. Please contact us to renew.',
};

const failure = (code: string): Resolved => ({ kind: 'error', message: code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR });
const signedIn = (me: Me): Resolved => ({ kind: 'text', text: `Signed in as ${me.name}.` });

/**
 * Decides what /status shows. Call with `/api/me` first; a student yields `need-status`, then call again with
 * the `/api/me/status` result.
 */
export function resolveStatus(me: ApiResult<Me>, st?: ApiResult<StatusData>): Resolved {
  if (!me.ok) return me.error.status === 401 ? { kind: 'redirect', to: '/login' } : failure(me.error.code);
  if (!me.data.roles.includes('student')) return signedIn(me.data);
  if (!st) return { kind: 'need-status' };
  if (!st.ok) {
    if (st.error.status === 401) return { kind: 'redirect', to: '/login' };
    if (st.error.status === 403) return signedIn(me.data);
    return failure(st.error.code);
  }
  if (st.data.status === 'active') return { kind: 'redirect', to: '/learn' };
  const text = COPY[st.data.status];
  return text ? { kind: 'text', text } : failure('INTERNAL');
}
