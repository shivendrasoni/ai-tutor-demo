import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, dispatch, registerRoutes } from '../../core/router';
import { CORE_KEY, coreSeed, type CoreSeed } from '../../core/seed-core';
import { getPersona, getSlice, initStore } from '../../core/store';
import { routes, seed } from './index';
import type { PlatformSlice } from './types';

const u = (p: string) => new URL(p, 'http://localhost');
const call = async (method: string, path: string, body?: unknown) => {
  const res = await dispatch(method, u(path), body === undefined ? undefined : { body: JSON.stringify(body) });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
};

beforeEach(() => {
  initStore({ [CORE_KEY]: coreSeed, platform: seed });
  clearRoutes();
  registerRoutes(routes);
});

describe('platform handlers', () => {
  it('lists schools, plans, costs and routing with real shapes', async () => {
    const schools = (await call('GET', '/api/platform/schools')).json.schools;
    expect(schools.length).toBeGreaterThanOrEqual(4);
    expect(schools.find((s: any) => s.name.startsWith('Greenfield')).branches.map((b: any) => b.signupCode)).toEqual(['GRN-NORTH', 'GRN-SOUTH']);
    expect((await call('GET', '/api/plans')).json.plans.length).toBeGreaterThan(1);
    expect((await call('GET', '/api/platform/costs?days=30')).json.bySchool.length).toBe(4);
    expect((await call('GET', '/api/platform/routing')).json.turns).toBeGreaterThan(0);
    const bad = await call('GET', '/api/platform/costs?days=3');
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('VALIDATION');
  });

  it('creates a school, a branch and a plan', async () => {
    const { id } = (await call('POST', '/api/platform/schools', { name: 'Cedar Hill School', board: 'CBSE' })).json;
    expect((await call('POST', '/api/platform/schools', { name: '  ', board: 'CBSE' })).status).toBe(400);
    const br = await call('POST', `/api/platform/schools/${id}/branches`, { name: 'Hilltop' });
    expect(br.json.signupCode).toMatch(/^CH-HILLT/);
    expect((await call('POST', '/api/platform/schools/nope/branches', { name: 'x' })).json.error.code).toBe('NOT_FOUND');
    expect((await call('GET', `/api/join/code/${br.json.signupCode}`)).json.branchName).toBe('Hilltop');
    await call('POST', '/api/platform/plans', { name: 'Quarterly', interval: 'monthly', priceMinor: 120000, currency: 'inr' });
    expect(getSlice<PlatformSlice>('platform').plans.at(-1)).toMatchObject({ name: 'Quarterly', currency: 'INR' });
    expect((await call('POST', '/api/platform/plans', { name: 'x', interval: 'weekly', priceMinor: 1 })).status).toBe(400);
  });

  it('recording a payment removes the pending row and activates the core student', async () => {
    const before = (await call('GET', '/api/platform/pending')).json.pending;
    expect(before.some((p: any) => p.subscriptionId === 'sub-kabir')).toBe(true);
    const ok = await call('POST', '/api/platform/payments', { subscriptionId: 'sub-kabir', amountMinor: 49900, currency: 'INR', externalRef: 'UPI-1', paidAt: new Date().toISOString() });
    expect(ok.status).toBe(200);
    expect(ok.json.periodEnd).toBeTruthy();
    expect(getSlice<CoreSeed>(CORE_KEY).users.find((x) => x.id === 'u-kabir')!.status).toBe('active');
    expect((await call('GET', '/api/platform/pending')).json.pending.some((p: any) => p.subscriptionId === 'sub-kabir')).toBe(false);
    expect((await call('POST', '/api/platform/payments', { subscriptionId: 'sub-kabir', amountMinor: 1, paidAt: new Date().toISOString() })).json.error.code).toBe('NOT_FOUND');
  });

  it('validates payments', async () => {
    const future = new Date(Date.now() + 86_400_000 * 3).toISOString();
    expect((await call('POST', '/api/platform/payments', { subscriptionId: 'sub-rudra', amountMinor: 100, paidAt: future })).json.error.code).toBe('VALIDATION');
    expect((await call('POST', '/api/platform/payments', { subscriptionId: 'sub-rudra', amountMinor: 0, paidAt: new Date().toISOString() })).status).toBe(400);
    expect((await call('POST', '/api/platform/payments', { subscriptionId: 'sub-rudra', amountMinor: 100, externalRef: 'UPI-4471920', paidAt: new Date().toISOString() })).status).toBe(400);
  });

  it('reviews flags', async () => {
    const open = (await call('GET', '/api/platform/flags')).json.flags;
    expect(open.length).toBeGreaterThan(3);
    const id = open[0].messageId;
    const conv = (await call('GET', `/api/platform/flags/${id}`)).json;
    expect(conv.messages.some((m: any) => m.id === id)).toBe(true);
    expect((await call('POST', `/api/platform/flags/${id}/review`)).status).toBe(204);
    expect((await call('GET', '/api/platform/flags')).json.flags.length).toBe(open.length - 1);
    expect((await call('GET', '/api/platform/flags?status=reviewed')).json.flags.some((f: any) => f.messageId === id)).toBe(true);
    expect((await call('POST', '/api/platform/flags/zzz/review')).status).toBe(404);
  });

  it('updates routing config with validation', async () => {
    const body = { advancedShareCapPct: 50, advancedMinGrade: 8, offTopicFilter: false };
    expect((await call('PUT', '/api/platform/routing/config', body)).json).toMatchObject(body);
    expect((await call('PUT', '/api/platform/routing/config', { ...body, advancedShareCapPct: 150 })).status).toBe(400);
  });
});

describe('join and invite', () => {
  it('looks up codes', async () => {
    expect((await call('GET', '/api/join/code/grn-north')).json).toMatchObject({ schoolName: 'Greenfield International School', branchName: 'North Campus' });
    expect((await call('GET', '/api/join/code/NOPE')).json.error.code).toBe('INVALID_CODE');
    expect((await call('GET', '/api/join/code/LVP-ANNEX')).json.error.code).toBe('CODE_DISABLED');
  });

  it('checks usernames', async () => {
    expect((await call('GET', '/api/join/username?u=kabir.shah')).json.available).toBe(false);
    expect((await call('GET', '/api/join/username?u=fresh.name')).json.available).toBe(true);
    expect((await call('GET', '/api/join/username?u=ab')).json.error.code).toBe('INVALID_USERNAME');
  });

  const signup = (over: object = {}) => ({
    code: 'GRN-SOUTH', grade: 8, studentName: 'Tia Das', parentName: 'Ravi Das', parentPhone: '99999', planId: 'plan-monthly',
    username: 'tia.das', password: 'longenough1', ...over,
  });

  it('signs up into the pending state', async () => {
    expect((await call('POST', '/api/join', signup({ username: 'kabir.shah' }))).json.error.code).toBe('USERNAME_TAKEN');
    expect((await call('POST', '/api/join', signup({ password: 'x' }))).json.error.code).toBe('WEAK_PASSWORD');
    expect((await call('POST', '/api/join', signup({ code: 'BAD' }))).json.error.code).toBe('INVALID_CODE');
    expect((await call('POST', '/api/join', signup())).status).toBe(200);
    expect(getPersona()).toBe('student_pending');
    expect((await call('GET', '/api/me')).json).toMatchObject({ name: 'Tia Das', roles: ['student'] });
    expect((await call('GET', '/api/me/status')).json.status).toBe('pending_payment');
    await call('POST', '/api/me/demo-pay');
    expect((await call('GET', '/api/me/status')).json.status).toBe('active');
  });

  it('status of Kabir flips to active after demo-pay', async () => {
    const { setPersona } = await import('../../core/store');
    setPersona('student_pending');
    expect((await call('GET', '/api/me/status')).json.status).toBe('pending_payment');
    await call('POST', '/api/me/demo-pay');
    expect((await call('GET', '/api/me/status')).json.status).toBe('active');
    expect(getSlice<CoreSeed>(CORE_KEY).users.find((x) => x.id === 'u-kabir')!.status).toBe('active');
  });

  it('completes an invite once', async () => {
    expect((await call('GET', '/api/invite/demo-invite')).json.studentName).toBe('Neha Sharma');
    expect((await call('POST', '/api/invite/demo-invite', { planId: 'plan-annual', username: 'neha.s', password: 'longenough1' })).status).toBe(200);
    expect((await call('GET', '/api/invite/demo-invite')).status).toBe(410);
    expect((await call('GET', '/api/invite/unknown')).json.error.code).toBe('INVITE_INVALID');
  });
});
