import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { messages, payments, subscriptions } from '@/db/schema';
import { createSession } from '@/modules/tenancy';
import { resetDb } from '../helpers/db';
import { recentPaidAt } from '../helpers/dates';
import { insertMessage, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';

import * as schoolsRoute from '@/app/api/platform/schools/route';
import * as branchesRoute from '@/app/api/platform/schools/[id]/branches/route';
import * as plansRoute from '@/app/api/platform/plans/route';
import * as flagsRoute from '@/app/api/platform/flags/route';
import * as reviewRoute from '@/app/api/platform/flags/[messageId]/review/route';
import * as costsRoute from '@/app/api/platform/costs/route';
import * as routingRoute from '@/app/api/platform/routing/route';
import * as enrollmentRoute from '@/app/api/school/enrollment/route';
import * as progressRoute from '@/app/api/teacher/progress/route';
import * as usageRoute from '@/app/api/teacher/usage/route';
import * as paymentsRoute from '@/app/api/platform/payments/route';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const sid = async (userId: string) => `sid=${await createSession(userId)}`;
function req(path: string, cookie?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const uuid0 = '00000000-0000-4000-8000-000000000000';

describe('platform GETs', () => {
  const gets: [string, (r: Request) => Promise<Response>, string][] = [
    ['schools', schoolsRoute.GET, '/api/platform/schools'],
    ['plans', plansRoute.GET, '/api/platform/plans'],
    ['flags', flagsRoute.GET, '/api/platform/flags'],
    ['costs', costsRoute.GET, '/api/platform/costs'],
    ['routing', routingRoute.GET, '/api/platform/routing'],
  ];
  it('200 for platform admin, 403 for school_admin, 401 anonymous', async () => {
    const platform = await sid(w.platform.userId);
    const school = await sid(w.a.schoolAdmin.userId);
    for (const [, h, url] of gets) {
      expect((await h(req(url, platform))).status).toBe(200);
      expect((await h(req(url, school))).status).toBe(403);
      expect((await h(req(url))).status).toBe(401);
    }
  });
  it('costs/routing reject days=14 and non-numeric with 400 VALIDATION; accept 7 and 30', async () => {
    const platform = await sid(w.platform.userId);
    for (const h of [costsRoute.GET, routingRoute.GET]) {
      for (const d of ['14', 'abc', '']) {
        const res = await h(req(`/x?days=${d}`, platform));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('VALIDATION');
      }
      expect((await h(req('/x?days=30', platform))).status).toBe(200);
      expect((await h(req('/x?days=7', platform))).status).toBe(200);
    }
  });
  it('flags rejects an unknown status with 400', async () => {
    const res = await flagsRoute.GET(req('/x?status=bogus', await sid(w.platform.userId)));
    expect(res.status).toBe(400);
  });
});

describe('platform creation round trips', () => {
  it('create school, branch, plan', async () => {
    const platform = await sid(w.platform.userId);
    const s = await schoolsRoute.POST(req('/x', platform, { name: 'New School', board: 'ICSE' }));
    expect(s.status).toBe(201);
    const { id } = await s.json();
    const b = await branchesRoute.POST(req('/x', platform, { name: 'Main' }), { params: Promise.resolve({ id }) });
    expect(b.status).toBe(201);
    expect((await b.json()).signupCode).toHaveLength(8);
    const p = await plansRoute.POST(req('/x', platform, { name: 'Quarterly', interval: 'annual', priceMinor: 99900 }));
    expect(p.status).toBe(201);
    expect((await p.json()).id).toEqual(expect.any(String));
    const list = await (await schoolsRoute.GET(req('/x', platform))).json();
    expect(JSON.stringify(list)).toContain('New School');
  });
  it('validation: malformed school id -> 404, bad bodies -> 400, non-platform -> 403', async () => {
    const platform = await sid(w.platform.userId);
    expect((await branchesRoute.POST(req('/x', platform, { name: 'M' }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    expect((await branchesRoute.POST(req('/x', platform, {}), { params: Promise.resolve({ id: uuid0 }) })).status).toBe(400);
    expect((await schoolsRoute.POST(req('/x', platform, { name: 'x' }))).status).toBe(400);
    expect((await plansRoute.POST(req('/x', platform, { name: 'x', interval: 'weekly', priceMinor: 1 }))).status).toBe(400);
    expect((await plansRoute.POST(req('/x', platform, { name: 'x', interval: 'monthly', priceMinor: 1.5 }))).status).toBe(400);
    const school = await sid(w.a.schoolAdmin.userId);
    expect((await schoolsRoute.POST(req('/x', school, { name: 'x', board: 'y' }))).status).toBe(403);
  });
});

describe('flags review', () => {
  it('moves a flag from open to reviewed and returns 204', async () => {
    const platform = await sid(w.platform.userId);
    const messageId = await insertMessage({
      schoolId: w.a.schoolId, studentId: w.a.studentId, role: 'assistant', createdAt: new Date(), flagged: true, flagReason: 'x',
    });
    const open = await (await flagsRoute.GET(req('/x?status=open', platform))).json();
    expect(JSON.stringify(open)).toContain(messageId);
    const res = await reviewRoute.POST(req('/x', platform, undefined, 'POST'), { params: Promise.resolve({ messageId }) });
    expect(res.status).toBe(204);
    const [row] = await withPlatform((tx) => tx.select({ r: messages.reviewedAt }).from(messages).where(eq(messages.id, messageId)));
    expect(row.r).not.toBeNull();
    const reviewed = await (await flagsRoute.GET(req('/x?status=reviewed', platform))).json();
    expect(JSON.stringify(reviewed)).toContain(messageId);
    expect(JSON.stringify(await (await flagsRoute.GET(req('/x', platform))).json())).not.toContain(messageId);
  });
  it('malformed messageId -> 404; school admin -> 403', async () => {
    const platform = await sid(w.platform.userId);
    expect((await reviewRoute.POST(req('/x', platform, undefined, 'POST'), { params: Promise.resolve({ messageId: 'zzz' }) })).status).toBe(404);
    expect((await reviewRoute.POST(req('/x', await sid(w.a.schoolAdmin.userId), undefined, 'POST'), { params: Promise.resolve({ messageId: uuid0 }) })).status).toBe(403);
  });
});

describe('/api/school/enrollment', () => {
  it('branch_admin passing another branchId or schoolId gets 403, not their own data (Review Focus 4)', async () => {
    const ba = await sid(w.a.branchAdmin.userId);
    const sa = await sid(w.a.schoolAdmin.userId);
    expect((await enrollmentRoute.GET(req(`/x?branchId=${w.aBranch2Id}`, ba))).status).toBe(403);
    expect((await enrollmentRoute.GET(req(`/x?schoolId=${w.b.schoolId}`, ba))).status).toBe(403);
    expect((await enrollmentRoute.GET(req(`/x?schoolId=${w.b.schoolId}`, sa))).status).toBe(403);
    expect((await enrollmentRoute.GET(req(`/x?branchId=${w.b.branchId}`, sa))).status).toBe(403);
    const ok = await enrollmentRoute.GET(req('/x', ba));
    expect(ok.status).toBe(200);
    const { summary } = await ok.json();
    expect(summary.every((r: { branchId: string }) => r.branchId === w.a.branchId)).toBe(true);
    expect((await enrollmentRoute.GET(req(`/x?branchId=${w.a.branchId}`, ba))).status).toBe(200);
  });
  it('school_admin sees all branches, or one with branchId; platform needs schoolId; bad uuid 400', async () => {
    const sa = await sid(w.a.schoolAdmin.userId);
    const all = (await (await enrollmentRoute.GET(req('/x', sa))).json()).summary;
    expect(new Set(all.map((r: { branchId: string }) => r.branchId)).size).toBe(2);
    const one = (await (await enrollmentRoute.GET(req(`/x?branchId=${w.aBranch2Id}`, sa))).json()).summary;
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((r: { branchId: string }) => r.branchId === w.aBranch2Id)).toBe(true);
    const platform = await sid(w.platform.userId);
    expect((await enrollmentRoute.GET(req('/x', platform))).status).toBe(400);
    expect((await enrollmentRoute.GET(req(`/x?schoolId=${w.b.schoolId}`, platform))).status).toBe(200);
    expect((await enrollmentRoute.GET(req('/x?schoolId=nope', platform))).status).toBe(400);
    expect((await enrollmentRoute.GET(req('/x?branchId=nope', sa))).status).toBe(400);
    expect((await enrollmentRoute.GET(req('/x'))).status).toBe(401);
  });
});

describe('teacher progress/usage', () => {
  it('assigned section 200, unassigned 403, missing/malformed ids 400', async () => {
    const t = await sid(w.a.teacher.userId);
    const q = (sectionId: string) => `?sectionId=${sectionId}&subjectId=${w.a.subjectId}`;
    for (const h of [progressRoute.GET, usageRoute.GET]) {
      expect((await h(req(`/x${q(w.a.sectionId)}`, t))).status).toBe(200);
      expect((await h(req(`/x${q(w.aSection9Id)}`, t))).status).toBe(403);
      expect((await h(req(`/x?sectionId=${w.a.sectionId}&subjectId=${w.aSubject2Id}`, t))).status).toBe(403);
      expect((await h(req('/x', t))).status).toBe(400);
      expect((await h(req('/x?sectionId=bad&subjectId=bad', t))).status).toBe(400);
      expect((await h(req(`/x${q(w.a.sectionId)}`))).status).toBe(401);
    }
  });
});

describe('payments amount', () => {
  it('a paidAt later than today (UTC) -> 400 VALIDATION, nothing recorded', async () => {
    const platform = await sid(w.platform.userId);
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await paymentsRoute.POST(req('/x', platform, { subscriptionId: w.a.subscriptionId, amountMinor: 40000, paidAt: future }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
    const rows = await withPlatform((tx) => tx.select().from(payments).where(eq(payments.subscriptionId, w.a.subscriptionId)));
    expect(rows).toHaveLength(0);
  });
  const paidAt = recentPaidAt().toISOString();
  it('amount different from plan price is stored as typed (Review Focus 3)', async () => {
    const platform = await sid(w.platform.userId);
    const res = await paymentsRoute.POST(req('/x', platform, { subscriptionId: w.a.subscriptionId, amountMinor: 40000, currency: 'INR', paidAt }));
    expect(res.status).toBe(200);
    const rows = await withPlatform((tx) => tx.select().from(payments).where(eq(payments.subscriptionId, w.a.subscriptionId)));
    expect(rows.map((r) => r.amountMinor)).toEqual([40000]);
    const [sub] = await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, w.a.subscriptionId)));
    expect(sub.status).toBe('active');
  });
  it('amountMinor 0, negative, or fractional -> 400 VALIDATION', async () => {
    const platform = await sid(w.platform.userId);
    for (const amountMinor of [0, -5, 499.5]) {
      const res = await paymentsRoute.POST(req('/x', platform, { subscriptionId: w.a.subscriptionId, amountMinor, paidAt }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
  });
});
