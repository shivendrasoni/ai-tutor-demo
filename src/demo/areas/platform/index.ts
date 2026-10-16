import { ApiError, type Routes } from '../../core/router';
import { CORE_KEY, type CoreSeed } from '../../core/seed-core';
import { getPersona, getSlice, mutateSlice, setPersona } from '../../core/store';
import { personaById } from '../../core/personas';
import { seed as platformSeed } from './fixtures';
import {
  findBranchByCode, parseDays, parseFlagStatus, sectionsForBranch, selectCosts, selectFlagged, selectFlags, selectOverview,
  selectPending, selectRouting, selectSchools,
} from './selectors';
import type { PlatformSlice, RoutingConfig } from './types';

export const PLATFORM_KEY = 'platform';
export const seed: PlatformSlice = platformSeed;

const get = () => getSlice<PlatformSlice>(PLATFORM_KEY);
const mutate = (fn: (d: PlatformSlice) => void) => mutateSlice<PlatformSlice>(PLATFORM_KEY, fn);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function addInterval(start: Date, interval: 'monthly' | 'annual'): Date {
  const months = interval === 'annual' ? 12 : 1;
  const total = start.getUTCFullYear() * 12 + start.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
}

/** Records a payment against a pending/lapsed subscription and activates the matching core student. */
export function recordPayment(input: { subscriptionId: string; amountMinor: number; currency: string; externalRef?: string; paidAt: string }) {
  const s = get();
  const row = s.pending.find((p) => p.subscriptionId === input.subscriptionId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Subscription not found');
  const currency = String(input.currency ?? 'INR').trim().toUpperCase();
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 2147483647) {
    throw new ApiError(400, 'VALIDATION', 'Amount must be greater than zero');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'VALIDATION', 'Invalid currency');
  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) throw new ApiError(400, 'VALIDATION', 'Enter a valid paid-at date');
  const now = Date.now();
  if (paidAt.getTime() > now + 5 * 60_000) throw new ApiError(400, 'VALIDATION', 'paidAt cannot be in the future');
  if (paidAt.getTime() < now - 365 * 86_400_000) throw new ApiError(400, 'VALIDATION', 'paidAt cannot be more than a year ago');
  const ref = input.externalRef?.trim() || null;
  if (ref && s.payments.some((p) => p.externalRef === ref)) {
    throw new ApiError(400, 'VALIDATION', 'This payment reference was already recorded');
  }
  const plan = s.plans.find((p) => p.name === row.planName);
  const periodEnd = addInterval(paidAt, plan?.interval ?? 'monthly');
  mutate((d) => {
    d.pending = d.pending.filter((p) => p.subscriptionId !== row.subscriptionId);
    d.payments.unshift({
      id: `pay-${d.counter++}`, subscriptionId: row.subscriptionId, studentName: row.studentName, schoolName: row.schoolName,
      planName: row.planName, amountMinor: input.amountMinor, currency, externalRef: ref, paidAt: paidAt.toISOString(), periodEnd: periodEnd.toISOString(),
    });
  });
  if (row.userId) {
    mutateSlice<CoreSeed>(CORE_KEY, (d) => {
      const u = d.users.find((x) => x.id === row.userId);
      if (u) u.status = 'active';
    });
  }
  return { periodStart: paidAt.toISOString(), periodEnd: periodEnd.toISOString() };
}

function normalizeUsername(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.]{4,32}$/.test(u)) throw new ApiError(400, 'INVALID_USERNAME', 'Username must be 4–32 letters, numbers, _ or .');
  return u;
}

function isTaken(u: string): boolean {
  const core = getSlice<CoreSeed>(CORE_KEY);
  return get().takenUsernames.includes(u) || core.users.some((x) => x.username.toLowerCase() === u);
}

function suggest(u: string): string[] {
  const out: string[] = [];
  for (let i = 1; out.length < 3 && i < 100; i++) {
    const cand = `${u}${i + 6}`.slice(0, 32);
    if (!isTaken(cand)) out.push(cand);
  }
  return out;
}

function checkCredentials(usernameRaw: unknown, password: unknown): string {
  const username = normalizeUsername(String(usernameRaw ?? ''));
  if (typeof password !== 'string' || password.length < 8) throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
  if (isTaken(username)) throw new ApiError(409, 'USERNAME_TAKEN', 'That username is taken');
  return username;
}

function addSignup(args: {
  studentName: string; username: string; schoolName: string; branchName: string; grade: number; parentName: string; parentPhone: string; planId: string;
}) {
  const plan = get().plans.find((p) => p.id === args.planId);
  if (!plan) throw new ApiError(400, 'VALIDATION', 'Unknown or inactive plan');
  const subscriptionId = `sub-new-${get().counter}`;
  mutate((d) => {
    d.counter++;
    d.takenUsernames.push(args.username);
    d.pending.push({
      subscriptionId, status: 'pending_payment', studentName: args.studentName, username: args.username, schoolName: args.schoolName,
      branchName: args.branchName, grade: args.grade, parentName: args.parentName, parentPhone: args.parentPhone, planName: plan.name,
      priceMinor: plan.priceMinor, currency: plan.currency, createdAt: new Date().toISOString(),
    });
    d.signupSubscriptionId = subscriptionId;
    d.signupName = args.studentName;
  });
  setPersona('student_pending');
  return { subscriptionId };
}

/** The subscription the pending-student persona is waiting on: the latest demo signup, else Kabir's. */
const currentSubscription = () => get().signupSubscriptionId ?? 'sub-kabir';

function currentUser() {
  const persona = personaById(getPersona());
  const core = getSlice<CoreSeed>(CORE_KEY);
  return { persona, user: core.users.find((u) => u.id === persona.userId) ?? null };
}

export const routes: Routes = {
  // ---- platform admin ----
  'GET /api/platform/schools': () => ({ schools: selectSchools(get()) }),
  'POST /api/platform/schools': ({ body }) => {
    const name = str(body?.name);
    const board = str(body?.board);
    if (!name || name.length > 200) throw new ApiError(400, 'VALIDATION', 'School name is required (max 200 characters)');
    if (!board || board.length > 50) throw new ApiError(400, 'VALIDATION', 'Board is required (max 50 characters)');
    if (get().schools.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'VALIDATION', 'A school with this name already exists');
    const id = `sch-${get().counter}`;
    mutate((d) => {
      d.counter++;
      d.schools.push({ id, name, board, branches: [] });
    });
    return { id };
  },
  'POST /api/platform/schools/:id/branches': ({ params, body }) => {
    const name = str(body?.name);
    if (!name || name.length > 200) throw new ApiError(400, 'VALIDATION', 'Branch name is required (max 200 characters)');
    const school = get().schools.find((s) => s.id === params.id);
    if (!school) throw new ApiError(404, 'NOT_FOUND', 'School not found');
    const initials = school.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(the|of|school)$/i.test(w)).map((w) => w[0]!.toUpperCase()).join('').slice(0, 4) || 'SCH';
    const word = name.split(/\s+/)[0]!.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'BR';
    let code = `${initials}-${word}`;
    for (let i = 2; findBranchByCode(get(), code); i++) code = `${initials}-${word}${i}`;
    const id = `b-${get().counter}`;
    mutate((d) => {
      d.counter++;
      d.schools.find((s) => s.id === params.id)!.branches.push({ id, name, signupCode: code, signupCodeEnabled: true });
    });
    return { id, signupCode: code };
  },
  'GET /api/platform/plans': () => ({ plans: get().plans }),
  'GET /api/plans': () => ({ plans: get().plans }),
  'POST /api/platform/plans': ({ body }) => {
    const name = str(body?.name);
    if (!name || name.length > 100) throw new ApiError(400, 'VALIDATION', 'Plan name is required (max 100 characters)');
    if (body?.interval !== 'monthly' && body?.interval !== 'annual') throw new ApiError(400, 'VALIDATION', 'Interval must be monthly or annual');
    const price = body?.priceMinor;
    if (!Number.isInteger(price) || price < 0 || price > 2147483647) throw new ApiError(400, 'VALIDATION', 'Invalid price');
    const currency = str(body?.currency ?? 'INR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'VALIDATION', 'Currency must be a 3-letter code');
    const id = `plan-${get().counter}`;
    mutate((d) => {
      d.counter++;
      d.plans.push({ id, name, interval: body.interval, priceMinor: price, currency });
    });
    return { id };
  },
  'GET /api/platform/pending': () => ({ pending: selectPending(get()) }),
  'POST /api/platform/payments': ({ body }) =>
    recordPayment({
      subscriptionId: String(body?.subscriptionId ?? ''), amountMinor: body?.amountMinor, currency: body?.currency ?? 'INR',
      externalRef: typeof body?.externalRef === 'string' ? body.externalRef : undefined, paidAt: String(body?.paidAt ?? ''),
    }),
  'GET /api/platform/overview': () => selectOverview(get()),
  'GET /api/platform/flags': ({ query }) => ({ flags: selectFlags(get(), parseFlagStatus(query.get('status'))) }),
  'GET /api/platform/flags/:messageId': ({ params }) => selectFlagged(get(), params.messageId),
  'POST /api/platform/flags/:messageId/review': ({ params }) => {
    if (!get().flags.some((f) => f.messageId === params.messageId)) throw new ApiError(404, 'NOT_FOUND', 'Flagged message not found');
    mutate((d) => {
      const f = d.flags.find((x) => x.messageId === params.messageId)!;
      f.reviewedAt ??= new Date().toISOString();
    });
    return null;
  },
  'GET /api/platform/costs': ({ query }) => selectCosts(get(), parseDays(query.get('days'))),
  'GET /api/platform/routing': ({ query }) => selectRouting(get(), parseDays(query.get('days'))),
  'GET /api/platform/routing/config': () => get().routingConfig,
  'PUT /api/platform/routing/config': ({ body }) => {
    const cap = body?.advancedShareCapPct;
    const grade = body?.advancedMinGrade;
    if (!Number.isInteger(cap) || cap < 0 || cap > 100) throw new ApiError(400, 'VALIDATION', 'Advanced share cap must be between 0 and 100');
    if (!Number.isInteger(grade) || grade < 5 || grade > 12) throw new ApiError(400, 'VALIDATION', 'Minimum grade must be between 5 and 12');
    const next: Partial<RoutingConfig> = { advancedShareCapPct: cap, advancedMinGrade: grade, offTopicFilter: !!body?.offTopicFilter };
    for (const k of ['basicModel', 'advancedModel', 'deciderModel'] as const) {
      if (typeof body?.[k] === 'string' && body[k].trim()) next[k] = body[k].trim();
    }
    mutate((d) => {
      Object.assign(d.routingConfig, next);
    });
    return get().routingConfig;
  },

  // ---- public: join / invite ----
  'GET /api/join/code/:code': ({ params }) => {
    const hit = findBranchByCode(get(), params.code);
    if (!hit) throw new ApiError(404, 'INVALID_CODE', 'This branch code is not valid');
    if (!hit.branch.signupCodeEnabled) throw new ApiError(403, 'CODE_DISABLED', 'Signups with this branch code are turned off');
    return { schoolName: hit.school.name, branchName: hit.branch.name, sections: sectionsForBranch(hit.branch.id) };
  },
  'GET /api/join/username': ({ query }) => {
    const username = normalizeUsername(query.get('u') ?? '');
    return isTaken(username) ? { username, available: false, suggestions: suggest(username) } : { username, available: true, suggestions: [] };
  },
  'POST /api/join': ({ body }) => {
    const hit = findBranchByCode(get(), String(body?.code ?? ''));
    if (!hit) throw new ApiError(404, 'INVALID_CODE', 'This branch code is not valid');
    if (!hit.branch.signupCodeEnabled) throw new ApiError(403, 'CODE_DISABLED', 'Signups with this branch code are turned off');
    const studentName = str(body?.studentName);
    const parentName = str(body?.parentName);
    const parentPhone = str(body?.parentPhone);
    const grade = body?.grade;
    if (!studentName || !parentName || !parentPhone) throw new ApiError(400, 'VALIDATION', 'Student name, parent name and parent phone are required');
    if (!Number.isInteger(grade) || grade < 5 || grade > 12) throw new ApiError(400, 'VALIDATION', 'Grade must be between 5 and 12');
    if (body?.sectionId && !sectionsForBranch(hit.branch.id).some((x) => x.id === body.sectionId && x.grade === grade)) {
      throw new ApiError(400, 'VALIDATION', 'Section does not belong to this branch and grade');
    }
    const username = checkCredentials(body?.username, body?.password);
    const r = addSignup({ studentName, username, schoolName: hit.school.name, branchName: hit.branch.name, grade, parentName, parentPhone, planId: String(body?.planId ?? '') });
    return { studentUserId: `u-${username}`, subscriptionId: r.subscriptionId };
  },
  'GET /api/invite/:token': ({ params }) => {
    const inv = get().invites[params.token];
    if (!inv || inv.used) throw new ApiError(410, 'INVITE_INVALID', 'This invite is invalid or has expired');
    return { studentName: inv.studentName, schoolName: inv.schoolName, branchName: inv.branchName, grade: inv.grade };
  },
  'POST /api/invite/:token': ({ params, body }) => {
    const inv = get().invites[params.token];
    if (!inv || inv.used) throw new ApiError(410, 'INVITE_INVALID', 'This invite is invalid or has expired');
    const username = checkCredentials(body?.username, body?.password);
    const r = addSignup({
      studentName: inv.studentName, username, schoolName: inv.schoolName, branchName: inv.branchName, grade: inv.grade,
      parentName: 'Invited parent', parentPhone: '—', planId: String(body?.planId ?? ''),
    });
    mutate((d) => {
      d.invites[params.token]!.used = true;
    });
    return r;
  },

  // ---- /api/me ----
  'GET /api/me': () => {
    const { persona, user } = currentUser();
    const s = get();
    const name = persona.id === 'student_pending' && s.signupName ? s.signupName : persona.name;
    return { name, roles: user ? [user.role] : [], isPlatformAdmin: persona.id === 'platform_admin' };
  },
  'GET /api/me/status': () => {
    const { persona, user } = currentUser();
    if (!user || user.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'Students only');
    const s = get();
    if (persona.id === 'student_pending') {
      const sub = currentSubscription();
      const pend = s.pending.find((p) => p.subscriptionId === sub);
      if (pend) return { status: pend.status, planName: pend.planName, periodEnd: null };
      const paid = s.payments.find((p) => p.subscriptionId === sub);
      if (paid) return { status: 'active', planName: paid.planName, periodEnd: paid.periodEnd };
    }
    const status = user.status === 'active' ? 'active' : user.status === 'lapsed' ? 'lapsed' : user.status === 'pending_payment' ? 'pending_payment' : 'removed';
    return { status, planName: status === 'pending_payment' ? 'Learner Monthly' : 'Learner Annual', periodEnd: status === 'active' ? '2027-08-21T00:00:00.000Z' : null };
  },
  /** Demo only: the "I've paid" button on /status records the payment as if the platform admin had. */
  'POST /api/me/demo-pay': () => {
    const sub = currentSubscription();
    const row = get().pending.find((p) => p.subscriptionId === sub);
    if (!row) return { alreadyActive: true };
    return recordPayment({ subscriptionId: sub, amountMinor: row.priceMinor, currency: row.currency, externalRef: `DEMO-${sub}`, paidAt: new Date().toISOString() });
  },
};
