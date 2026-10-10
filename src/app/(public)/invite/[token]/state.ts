import { genericMessage, type ApiResult } from '../../_lib/api';

export type InviteInfo = { studentName: string; schoolName: string; branchName: string; grade: number };

export type InviteLoadState =
  | { kind: 'ready'; invite: InviteInfo }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

export const INVITE_UNAVAILABLE = {
  title: 'Invite unavailable',
  copy: 'This invite link has expired or was already used. Ask your school for a new one.',
};

/** 404/410 mean the invite is gone for good; anything else is a retryable failure, not "expired". */
export function inviteLoadState(r: ApiResult<InviteInfo>): InviteLoadState {
  if (r.ok) return { kind: 'ready', invite: r.data };
  if (r.error.status === 404 || r.error.status === 410) return { kind: 'invalid' };
  return { kind: 'error', message: genericMessage(r.error) };
}
