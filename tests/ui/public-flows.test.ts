import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@/app/(public)/_lib/api';
import { GENERIC_ERROR, NETWORK_ERROR } from '@/app/(public)/_lib/api';
import { usernameCheckOutcome, USERNAME_RULES_HINT } from '@/app/(public)/_lib/username';
import { inviteLoadState, INVITE_UNAVAILABLE } from '@/app/(public)/invite/[token]/state';
import { resolveStatus } from '@/app/(public)/status/resolve';

const fail = (status: number, code: string): ApiResult<never> => ({ ok: false, error: { status, code } });
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

describe('inviteLoadState', () => {
  const invite = { studentName: 'Kabir', schoolName: 'Sunrise', branchName: 'Whitefield', grade: 8 };
  it('ready on success', () => expect(inviteLoadState(ok(invite))).toEqual({ kind: 'ready', invite }));
  it.each([404, 410])('status %i is the invalid/expired state', (s) =>
    expect(inviteLoadState(fail(s, 'INVITE_INVALID'))).toEqual({ kind: 'invalid' }));
  it('network failure and server errors are retryable errors, not "expired"', () => {
    expect(inviteLoadState(fail(0, 'NETWORK'))).toEqual({ kind: 'error', message: NETWORK_ERROR });
    expect(inviteLoadState(fail(500, 'INTERNAL'))).toEqual({ kind: 'error', message: GENERIC_ERROR });
  });
  it('invalid copy has a title and tells the user to ask the school', () => {
    expect(INVITE_UNAVAILABLE.title).toBe('Invite unavailable');
    expect(INVITE_UNAVAILABLE.copy).toBe('This invite link has expired or was already used. Ask your school for a new one.');
  });
});

describe('usernameCheckOutcome', () => {
  it('available: no suggestions and an "available" hint', () =>
    expect(usernameCheckOutcome(ok({ username: 'kid.one', available: true, suggestions: [] })))
      .toEqual({ hint: 'kid.one is available.', suggestions: [] }));
  it('taken: shows the suggestions and a "taken" hint', () =>
    expect(usernameCheckOutcome(ok({ username: 'kid.one', available: false, suggestions: ['kid.one1', 'kid.one2'] })))
      .toEqual({ hint: 'kid.one is taken.', suggestions: ['kid.one1', 'kid.one2'] }));
  it('INVALID_USERNAME shows the rules', () =>
    expect(usernameCheckOutcome(fail(400, 'INVALID_USERNAME'))).toEqual({ hint: USERNAME_RULES_HINT, suggestions: [] }));
  it.each([[0, 'NETWORK'], [500, 'INTERNAL'], [429, 'RATE_LIMITED']])('other failure %i/%s stays silent (submit re-validates)', (s, c) =>
    expect(usernameCheckOutcome(fail(s, c))).toEqual({ hint: '', suggestions: [] }));
});

describe('resolveStatus', () => {
  const me = (roles: string[]) => ok({ name: 'Asha', roles, isPlatformAdmin: false });
  const st = (status: string) => ok({ status, planName: null, periodEnd: null });

  it('me 401 -> login redirect; other me failures -> error', () => {
    expect(resolveStatus(fail(401, 'UNAUTHENTICATED'))).toEqual({ kind: 'redirect', to: '/login' });
    expect(resolveStatus(fail(0, 'NETWORK'))).toEqual({ kind: 'error', message: NETWORK_ERROR });
    expect(resolveStatus(fail(500, 'INTERNAL'))).toEqual({ kind: 'error', message: GENERIC_ERROR });
  });
  it('staff (no student role) see "Signed in as" and never need the status call', () =>
    expect(resolveStatus(me(['teacher']))).toEqual({ kind: 'text', text: 'Signed in as Asha.' }));
  it('student needs the status call', () => expect(resolveStatus(me(['student']))).toEqual({ kind: 'need-status' }));
  it('student + 403 status -> signed-in text; 401 -> login', () => {
    expect(resolveStatus(me(['student']), fail(403, 'FORBIDDEN'))).toEqual({ kind: 'text', text: 'Signed in as Asha.' });
    expect(resolveStatus(me(['student']), fail(401, 'UNAUTHENTICATED'))).toEqual({ kind: 'redirect', to: '/login' });
  });
  it('student + status failure -> error copy', () => {
    expect(resolveStatus(me(['student']), fail(0, 'NETWORK'))).toEqual({ kind: 'error', message: NETWORK_ERROR });
    expect(resolveStatus(me(['student']), fail(500, 'INTERNAL'))).toEqual({ kind: 'error', message: GENERIC_ERROR });
  });
  it('active -> /learn', () => expect(resolveStatus(me(['student']), st('active'))).toEqual({ kind: 'redirect', to: '/learn' }));
  it('pending_payment and lapsed copy', () => {
    expect(resolveStatus(me(['student']), st('pending_payment'))).toEqual({
      kind: 'text',
      text: "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.",
    });
    expect(resolveStatus(me(['student']), st('lapsed'))).toEqual({
      kind: 'text', text: 'Your plan has expired. Please contact us to renew.',
    });
  });
  it('removed / unknown status has no copy -> generic error', () => {
    expect(resolveStatus(me(['student']), st('removed'))).toEqual({ kind: 'error', message: GENERIC_ERROR });
    expect(resolveStatus(me(['student']), st('???'))).toEqual({ kind: 'error', message: GENERIC_ERROR });
  });
});
