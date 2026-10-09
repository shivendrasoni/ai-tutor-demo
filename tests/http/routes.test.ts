import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { createSession } from '@/modules/tenancy';
import { removeStudent } from '@/modules/enrollment';
import { DomainError } from '@/lib/errors';
import { handle } from '@/lib/http';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';

import * as loginRoute from '@/app/api/auth/login/route';
import * as logoutRoute from '@/app/api/auth/logout/route';
import * as joinRoute from '@/app/api/join/route';
import * as joinCodeRoute from '@/app/api/join/code/[code]/route';
import * as joinUsernameRoute from '@/app/api/join/username/route';
import * as inviteRoute from '@/app/api/invite/[token]/route';
import * as plansRoute from '@/app/api/plans/route';
import * as meStatusRoute from '@/app/api/me/status/route';
import * as meRoute from '@/app/api/me/route';
import * as studentsRoute from '@/app/api/school/students/route';
import * as removeRoute from '@/app/api/school/students/[id]/remove/route';
import * as branchCodeRoute from '@/app/api/school/branches/[id]/code/route';
import * as pendingRoute from '@/app/api/platform/pending/route';
import * as paymentsRoute from '@/app/api/platform/payments/route';

let seed: Seed;

beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

type Opts = { body?: unknown; raw?: string; cookie?: string; contentType?: string | null };
function req(method: string, path: string, opts: Opts = {}): Request {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  const contentType = opts.contentType === undefined ? 'application/json' : opts.contentType;
  if (body !== undefined && contentType !== null) headers.set('content-type', contentType);
  return new Request(`http://localhost${path}`, { method, headers, body });
}
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}
/** Logs in through the HTTP route and returns the `sid=...` cookie pair. */
async function loginCookie(userId: string): Promise<string> {
  const res = await loginRoute.POST(req('POST', '/api/auth/login', { body: { username: await usernameOf(userId), password: SEED_PASSWORD } }));
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}
async function sidFor(userId: string): Promise<string> {
  return `sid=${await createSession(userId)}`;
}

function signupBody(over: Record<string, unknown> = {}) {
  return {
    code: seed.a.code, grade: 8, sectionId: seed.a.sectionId, studentName: 'Riya Sharma',
    parentName: 'Anita Sharma', parentPhone: '9876543210', planId: seed.planId,
    username: 'riya.s', password: 'kid-password', ...over,
  };
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  const body = await res.json();
  expect(body.error.code).toBe(code);
  return body;
}

describe('auth', () => {
  it('login sets an httponly sid cookie and returns roles', async () => {
    const res = await loginRoute.POST(
      req('POST', '/api/auth/login', { body: { username: await usernameOf(seed.a.student.userId), password: SEED_PASSWORD } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ roles: ['student'], isPlatformAdmin: false });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]+;/);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it('platform admin login reports isPlatformAdmin', async () => {
    const res = await loginRoute.POST(
      req('POST', '/api/auth/login', { body: { username: await usernameOf(seed.platform.userId), password: SEED_PASSWORD } }),
    );
    expect(await res.json()).toEqual({ roles: [], isPlatformAdmin: true });
  });

  it('bad credentials → 401 INVALID_CREDENTIALS, body never echoes the password', async () => {
    const res = await loginRoute.POST(
      req('POST', '/api/auth/login', { body: { username: await usernameOf(seed.a.student.userId), password: 'wrong-password-xyz' } }),
    );
    const body = await expectError(res, 401, 'INVALID_CREDENTIALS');
    expect(JSON.stringify(body)).not.toContain('wrong-password-xyz');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('removed student → 403 ACCOUNT_REMOVED', async () => {
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    const res = await loginRoute.POST(
      req('POST', '/api/auth/login', { body: { username: await usernameOf(seed.a.studentId), password: SEED_PASSWORD } }),
    );
    await expectError(res, 403, 'ACCOUNT_REMOVED');
  });

  it('garbage JSON → 400 VALIDATION', async () => {
    const res = await loginRoute.POST(req('POST', '/api/auth/login', { raw: '{not json' }));
    await expectError(res, 400, 'VALIDATION');
  });

  it('missing fields → 400 VALIDATION', async () => {
    const res = await loginRoute.POST(req('POST', '/api/auth/login', { body: { username: 'x' } }));
    await expectError(res, 400, 'VALIDATION');
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const cookie = await loginCookie(seed.a.student.userId);
    const out = await logoutRoute.POST(req('POST', '/api/auth/logout', { cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/^sid=;.*Max-Age=0/);
    const res = await meStatusRoute.GET(req('GET', '/api/me/status', { cookie }));
    await expectError(res, 401, 'UNAUTHENTICATED');
  });
});

describe('join', () => {
  it('GET /api/join/code/:code returns school, branch and sections', async () => {
    const res = await joinCodeRoute.GET(req('GET', `/api/join/code/${seed.a.code}`), ctx({ code: seed.a.code.toLowerCase() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schoolName: 'School A', branchName: 'Branch A',
      sections: [{ id: seed.a.sectionId, grade: 8, name: '8-A' }],
    });
  });

  it('unknown code → 404 INVALID_CODE', async () => {
    const res = await joinCodeRoute.GET(req('GET', '/api/join/code/NOPE99'), ctx({ code: 'NOPE99' }));
    await expectError(res, 404, 'INVALID_CODE');
  });

  it('disabled code → 410 CODE_DISABLED on lookup', async () => {
    await branchCodeRoute.POST(
      req('POST', '/x', { body: { action: 'disable' }, cookie: await sidFor(seed.a.schoolAdmin.userId) }),
      ctx({ id: seed.a.branchId }),
    );
    const res = await joinCodeRoute.GET(req('GET', '/x'), ctx({ code: seed.a.code }));
    await expectError(res, 410, 'CODE_DISABLED');
  });

  it('POST /api/join → 201, then the new student can log in and is pending_payment', async () => {
    const res = await joinRoute.POST(req('POST', '/api/join', { body: signupBody() }));
    expect(res.status).toBe(201);
    const login = await loginRoute.POST(req('POST', '/api/auth/login', { body: { username: 'riya.s', password: 'kid-password' } }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const st = await meStatusRoute.GET(req('GET', '/api/me/status', { cookie }));
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({ status: 'pending_payment' });
  });

  it('POST /api/join with a disabled code → 410 CODE_DISABLED', async () => {
    const admin = await sidFor(seed.a.schoolAdmin.userId);
    const r = await branchCodeRoute.POST(req('POST', '/x', { body: { action: 'disable' }, cookie: admin }), ctx({ id: seed.a.branchId }));
    expect(r.status).toBe(200);
    const res = await joinRoute.POST(req('POST', '/api/join', { body: signupBody() }));
    await expectError(res, 410, 'CODE_DISABLED');
  });

  it('duplicate username → 409 USERNAME_TAKEN with details.suggestions', async () => {
    const taken = await usernameOf(seed.a.studentId);
    const res = await joinRoute.POST(req('POST', '/api/join', { body: signupBody({ username: taken }) }));
    const body = await expectError(res, 409, 'USERNAME_TAKEN');
    expect(Array.isArray(body.error.details.suggestions)).toBe(true);
    expect(body.error.details.suggestions.length).toBeGreaterThan(0);
  });

  it('weak password → 400 WEAK_PASSWORD and the body never contains the password', async () => {
    const res = await joinRoute.POST(req('POST', '/api/join', { body: signupBody({ password: 'abc' }) }));
    const body = await expectError(res, 400, 'WEAK_PASSWORD');
    expect(JSON.stringify(body)).not.toMatch(/"abc"/);
  });

  it('garbage JSON → 400 VALIDATION', async () => {
    const res = await joinRoute.POST(req('POST', '/api/join', { raw: 'garbage' }));
    await expectError(res, 400, 'VALIDATION');
  });

  it('GET /api/join/username reports availability and suggestions', async () => {
    const free = await joinUsernameRoute.GET(req('GET', '/api/join/username?u=Fresh.Name'));
    expect(free.status).toBe(200);
    expect(await free.json()).toEqual({ username: 'fresh.name', available: true, suggestions: [] });
    const taken = await usernameOf(seed.a.studentId);
    const t = await joinUsernameRoute.GET(req('GET', `/api/join/username?u=${encodeURIComponent(taken)}`));
    const tb = await t.json();
    expect(tb.available).toBe(false);
    expect(tb.suggestions.length).toBeGreaterThan(0);
    const missing = await joinUsernameRoute.GET(req('GET', '/api/join/username'));
    await expectError(missing, 400, 'VALIDATION');
  });
});

describe('plans', () => {
  it('GET /api/plans lists active plans', async () => {
    const res = await plansRoute.GET(req('GET', '/api/plans'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toEqual([
      { id: seed.planId, name: 'Monthly', interval: 'monthly', priceMinor: 49900, currency: 'INR' },
    ]);
  });
});

describe('me/status', () => {
  it('returns pending_payment for the seeded student via the login cookie', async () => {
    const cookie = await loginCookie(seed.a.student.userId);
    const res = await meStatusRoute.GET(req('GET', '/api/me/status', { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending_payment', planName: 'Monthly', periodEnd: null });
  });

  it('after removeStudent the same cookie → 401', async () => {
    const cookie = await loginCookie(seed.a.student.userId);
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    const res = await meStatusRoute.GET(req('GET', '/api/me/status', { cookie }));
    await expectError(res, 401, 'UNAUTHENTICATED');
  });

  it('no cookie / bogus cookie → 401', async () => {
    await expectError(await meStatusRoute.GET(req('GET', '/api/me/status')), 401, 'UNAUTHENTICATED');
    await expectError(await meStatusRoute.GET(req('GET', '/api/me/status', { cookie: 'sid=bogus' })), 401, 'UNAUTHENTICATED');
  });
});

describe('me', () => {
  it('returns name, roles and isPlatformAdmin for a student', async () => {
    const res = await meRoute.GET(req('GET', '/api/me', { cookie: await loginCookie(seed.a.student.userId) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'student A', roles: ['student'], isPlatformAdmin: false });
  });

  it('returns staff and platform admin identities', async () => {
    const t = await meRoute.GET(req('GET', '/api/me', { cookie: await sidFor(seed.a.teacher.userId) }));
    expect(await t.json()).toEqual({ name: 'teacher A', roles: ['teacher'], isPlatformAdmin: false });
    const p = await meRoute.GET(req('GET', '/api/me', { cookie: await sidFor(seed.platform.userId) }));
    expect(await p.json()).toEqual({ name: 'Platform Admin', roles: [], isPlatformAdmin: true });
  });

  it('no cookie → 401', async () => {
    await expectError(await meRoute.GET(req('GET', '/api/me')), 401, 'UNAUTHENTICATED');
  });
});

describe('school students', () => {
  it('unauthenticated → 401 on every protected route', async () => {
    await expectError(await studentsRoute.GET(req('GET', '/api/school/students')), 401, 'UNAUTHENTICATED');
    await expectError(await studentsRoute.POST(req('POST', '/api/school/students', { body: {} })), 401, 'UNAUTHENTICATED');
    await expectError(await removeRoute.POST(req('POST', '/x'), ctx({ id: seed.a.studentId })), 401, 'UNAUTHENTICATED');
    await expectError(
      await branchCodeRoute.POST(req('POST', '/x', { body: { action: 'rotate' } }), ctx({ id: seed.a.branchId })),
      401, 'UNAUTHENTICATED',
    );
    await expectError(await pendingRoute.GET(req('GET', '/api/platform/pending')), 401, 'UNAUTHENTICATED');
    await expectError(await paymentsRoute.POST(req('POST', '/api/platform/payments', { body: {} })), 401, 'UNAUTHENTICATED');
  });

  it('school admin lists own school students with filters', async () => {
    const cookie = await sidFor(seed.a.schoolAdmin.userId);
    const res = await studentsRoute.GET(req('GET', `/api/school/students?branchId=${seed.a.branchId}&grade=8&status=pending_payment`, { cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students.map((s: { userId: string }) => s.userId)).toEqual([seed.a.studentId]);
    const none = await studentsRoute.GET(req('GET', '/api/school/students?status=active', { cookie }));
    expect((await none.json()).students).toEqual([]);
  });

  it('bad filters → 400 VALIDATION', async () => {
    const cookie = await sidFor(seed.a.schoolAdmin.userId);
    await expectError(await studentsRoute.GET(req('GET', '/api/school/students?grade=abc', { cookie })), 400, 'VALIDATION');
    await expectError(await studentsRoute.GET(req('GET', '/api/school/students?status=bogus', { cookie })), 400, 'VALIDATION');
  });

  it('teacher → 403 FORBIDDEN', async () => {
    const cookie = await sidFor(seed.a.teacher.userId);
    await expectError(await studentsRoute.GET(req('GET', '/api/school/students', { cookie })), 403, 'FORBIDDEN');
  });

  it('POST manual add → 201 inviteUrl; invite GET/POST completes; reuse → 410 INVITE_INVALID', async () => {
    const cookie = await sidFor(seed.a.branchAdmin.userId);
    const res = await studentsRoute.POST(req('POST', '/api/school/students', {
      cookie,
      body: { branchId: seed.a.branchId, grade: 8, studentName: 'Kabir', parentName: 'P', parentPhone: '9000000000' },
    }));
    expect(res.status).toBe(201);
    const { inviteUrl } = await res.json();
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]+$/);
    const token = inviteUrl.split('/').pop()!;

    const g = await inviteRoute.GET(req('GET', `/api/invite/${token}`), ctx({ token }));
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ studentName: 'Kabir', schoolName: 'School A', branchName: 'Branch A', grade: 8 });

    const body = { planId: seed.planId, username: 'kabir.k', password: 'kabir-password' };
    const p = await inviteRoute.POST(req('POST', `/api/invite/${token}`, { body }), ctx({ token }));
    expect(p.status).toBe(200);

    const again = await inviteRoute.POST(req('POST', `/api/invite/${token}`, { body: { ...body, username: 'kabir.z' } }), ctx({ token }));
    await expectError(again, 410, 'INVITE_INVALID');
    await expectError(await inviteRoute.GET(req('GET', '/x'), ctx({ token })), 410, 'INVITE_INVALID');

    const login = await loginRoute.POST(req('POST', '/api/auth/login', { body: { username: 'kabir.k', password: 'kabir-password' } }));
    expect(login.status).toBe(200);
  });

  it('remove route removes a student; cross-school → 403/404', async () => {
    const other = await sidFor(seed.b.schoolAdmin.userId);
    const cross = await removeRoute.POST(req('POST', '/x', { cookie: other }), ctx({ id: seed.a.studentId }));
    expect([403, 404]).toContain(cross.status);

    const cookie = await sidFor(seed.a.schoolAdmin.userId);
    const res = await removeRoute.POST(req('POST', '/x', { cookie }), ctx({ id: seed.a.studentId }));
    expect(res.status).toBe(200);
    const list = await studentsRoute.GET(req('GET', '/api/school/students?status=removed', { cookie }));
    expect((await list.json()).students.map((s: { userId: string }) => s.userId)).toEqual([seed.a.studentId]);
  });

  it('branch code rotate returns a new code; enable/disable return no code; bad action → 400', async () => {
    const cookie = await sidFor(seed.a.schoolAdmin.userId);
    const r = await branchCodeRoute.POST(req('POST', '/x', { cookie, body: { action: 'rotate' } }), ctx({ id: seed.a.branchId }));
    expect(r.status).toBe(200);
    const { signupCode } = await r.json();
    expect(typeof signupCode).toBe('string');
    expect(signupCode).not.toBe(seed.a.code);
    const looked = await joinCodeRoute.GET(req('GET', '/x'), ctx({ code: signupCode }));
    expect(looked.status).toBe(200);

    const d = await branchCodeRoute.POST(req('POST', '/x', { cookie, body: { action: 'enable' } }), ctx({ id: seed.a.branchId }));
    expect(await d.json()).toEqual({});
    await expectError(
      await branchCodeRoute.POST(req('POST', '/x', { cookie, body: { action: 'explode' } }), ctx({ id: seed.a.branchId })),
      400, 'VALIDATION',
    );
    const teacher = await sidFor(seed.a.teacher.userId);
    await expectError(
      await branchCodeRoute.POST(req('POST', '/x', { cookie: teacher, body: { action: 'rotate' } }), ctx({ id: seed.a.branchId })),
      403, 'FORBIDDEN',
    );
  });
});

describe('platform', () => {
  it('GET /api/platform/pending as school admin → 403', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    await expectError(await pendingRoute.GET(req('GET', '/api/platform/pending', { cookie })), 403, 'FORBIDDEN');
  });

  it('platform admin sees pending and records a payment', async () => {
    const cookie = await loginCookie(seed.platform.userId);
    const p = await pendingRoute.GET(req('GET', '/api/platform/pending', { cookie }));
    expect(p.status).toBe(200);
    const { pending } = await p.json();
    expect(pending.map((r: { subscriptionId: string }) => r.subscriptionId).sort()).toEqual(
      [seed.a.subscriptionId, seed.b.subscriptionId].sort(),
    );

    const res = await paymentsRoute.POST(req('POST', '/api/platform/payments', {
      cookie,
      body: { subscriptionId: seed.a.subscriptionId, amountMinor: 49900, paidAt: '2026-10-01T00:00:00.000Z' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' });

    const st = await meStatusRoute.GET(req('GET', '/api/me/status', { cookie: await sidFor(seed.a.studentId) }));
    expect(await st.json()).toMatchObject({ status: 'active', periodEnd: '2026-11-01T00:00:00.000Z' });
  });

  it('payments: missing/invalid paidAt → 400 VALIDATION', async () => {
    const cookie = await sidFor(seed.platform.userId);
    const base = { subscriptionId: seed.a.subscriptionId, amountMinor: 49900 };
    await expectError(await paymentsRoute.POST(req('POST', '/x', { cookie, body: base })), 400, 'VALIDATION');
    await expectError(await paymentsRoute.POST(req('POST', '/x', { cookie, body: { ...base, paidAt: 'not-a-date' } })), 400, 'VALIDATION');
  });

  it('payment for a removed student → 409 STUDENT_REMOVED', async () => {
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    const cookie = await sidFor(seed.platform.userId);
    const res = await paymentsRoute.POST(req('POST', '/api/platform/payments', {
      cookie,
      body: { subscriptionId: seed.a.subscriptionId, amountMinor: 49900, paidAt: '2026-10-01T00:00:00.000Z' },
    }));
    await expectError(res, 409, 'STUDENT_REMOVED');
  });

  it('payments as school admin → 403', async () => {
    const cookie = await sidFor(seed.a.schoolAdmin.userId);
    const res = await paymentsRoute.POST(req('POST', '/x', {
      cookie, body: { subscriptionId: seed.a.subscriptionId, amountMinor: 1, paidAt: '2026-10-01T00:00:00.000Z' },
    }));
    await expectError(res, 403, 'FORBIDDEN');
  });
});

describe('readJson guards', () => {
  const loginBody = { username: 'someone', password: 'whatever-pass' };

  it('text/plain body → 400 VALIDATION (login CSRF via simple form/fetch is refused)', async () => {
    const res = await loginRoute.POST(req('POST', '/api/auth/login', { body: loginBody, contentType: 'text/plain' }));
    await expectError(res, 400, 'VALIDATION');
  });

  it('missing / form-encoded content type → 400 VALIDATION', async () => {
    await expectError(await loginRoute.POST(req('POST', '/api/auth/login', { body: loginBody, contentType: null })), 400, 'VALIDATION');
    await expectError(
      await loginRoute.POST(req('POST', '/api/auth/login', { raw: 'username=a&password=b', contentType: 'application/x-www-form-urlencoded' })),
      400, 'VALIDATION',
    );
  });

  it('application/json with a charset parameter is accepted', async () => {
    const res = await loginRoute.POST(req('POST', '/api/auth/login', { body: loginBody, contentType: 'Application/JSON; charset=utf-8' }));
    await expectError(res, 401, 'INVALID_CREDENTIALS');
  });

  it('body over 100 KB → 400 VALIDATION', async () => {
    const res = await joinRoute.POST(req('POST', '/api/join', { body: signupBody({ studentName: 'x'.repeat(101 * 1024) }) }));
    await expectError(res, 400, 'VALIDATION');
  });

  it('join caps field lengths', async () => {
    for (const over of [
      { studentName: 'x'.repeat(201) }, { parentName: 'x'.repeat(201) }, { username: 'x'.repeat(201) },
      { password: 'x'.repeat(129) }, { parentPhone: '9'.repeat(33) }, { parentEmail: `${'a'.repeat(250)}@x.io` },
    ]) {
      await expectError(await joinRoute.POST(req('POST', '/api/join', { body: signupBody(over) })), 400, 'VALIDATION');
    }
  });

  it('invite POST caps username and password', async () => {
    const token = 'anything';
    for (const over of [{ username: 'x'.repeat(201) }, { password: 'x'.repeat(129) }]) {
      const body = { planId: seed.planId, username: 'kabir.k', password: 'kabir-password', ...over };
      await expectError(await inviteRoute.POST(req('POST', `/api/invite/${token}`, { body }), ctx({ token })), 400, 'VALIDATION');
    }
  });

  it('manual add caps field lengths', async () => {
    const cookie = await sidFor(seed.a.branchAdmin.userId);
    const base = { branchId: seed.a.branchId, grade: 8, studentName: 'Kabir', parentName: 'P', parentPhone: '9000000000' };
    for (const over of [
      { studentName: 'x'.repeat(201) }, { parentName: 'x'.repeat(201) }, { parentPhone: '9'.repeat(33) },
      { parentEmail: `${'a'.repeat(250)}@x.io` },
    ]) {
      await expectError(
        await studentsRoute.POST(req('POST', '/api/school/students', { cookie, body: { ...base, ...over } })),
        400, 'VALIDATION',
      );
    }
  });
});

describe('handle()', () => {
  it('maps unexpected errors to 500 INTERNAL without leaking the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handle(async () => {
      throw new Error('db exploded: secret detail');
    });
    const res = await h(new Request('http://localhost/x'));
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL' } });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('never logs query params or the raw error (redacted console.error)', async () => {
    const secret = '$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0c2FsdA$FAKEHASHFAKEHASH';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drizzleLike = new Error(
      `Failed query: insert into "users" ("username", "password_hash") values ($1, $2)\nparams: kid,${secret}`,
      { cause: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) },
    );
    const plain = Object.assign(new Error(`boom params: ${secret}`), { params: [secret] });
    for (const e of [drizzleLike, plain]) {
      const res = await handle(async () => {
        throw e;
      })(new Request('http://localhost/x'));
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain(secret);
    }
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('FAKEHASH');
    expect(logged).not.toContain('insert into');
    expect(logged).toContain('23505');
    expect(logged).toContain('boom');
    spy.mockRestore();
  });

  it('maps DomainError details through', async () => {
    const h = handle(async () => {
      throw new DomainError('NOT_FOUND', 'nope', { field: 'x' });
    });
    const res = await h(new Request('http://localhost/x'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'nope', details: { field: 'x' } } });
  });
});
