import { GENERIC_ERROR, NETWORK_ERROR, type ApiResult } from '../../_lib/api';

export type Invite = { studentName: string; schoolName: string; branchName: string; grade: number };
export type Load =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; invite: Invite };

export const INVITE_UNAVAILABLE = {
  title: 'Invite unavailable',
  copy: 'This invite link has expired or was already used. Ask your school for a new one.',
};

const isInvalid = (status: number) => status === 404 || status === 410;

/** Maps the GET /api/invite/:token result to what the page renders. */
export function inviteLoadState(r: ApiResult<Invite>): Load {
  if (r.ok) return { kind: 'ready', invite: r.data };
  if (isInvalid(r.error.status)) return { kind: 'invalid' };
  return { kind: 'error', message: r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR };
}
