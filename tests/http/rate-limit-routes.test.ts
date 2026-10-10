import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';

const verifySpy = vi.hoisted(() => vi.fn());
vi.mock('@/modules/tenancy/auth/passwords', async (orig) => {
  const m = await orig<typeof import('@/modules/tenancy/auth/passwords')>();
  return { ...m, verifyPassword: (...a: Parameters<typeof m.verifyPassword>) => (verifySpy(...a), m.verifyPassword(...a)) };
});

import * as loginRoute from '@/app/api/auth/login/route';
import * as joinRoute from '@/app/api/join/route';
import * as joinCodeRoute from '@/app/api/join/code/[code]/route';
import * as joinUsernameRoute from '@/app/api/join/username/route';
import * as inviteRoute from '@/app/api/invite/[token]/route';

let seed: Seed;
let studentName: string;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  verifySpy.mockClear();
  const [u] = await withPlatform((tx) => tx.select({ u: users.username }).from(users).where(eq(users.id, seed.a.studentId)));
  studentName = u.u!;
});
afterAll(closeDb);

const post = (path: string, body: unknown, ip?: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, ip?: string) =>
  new Request(`http://localhost${path}`, { headers: ip ? { 'x-forwarded-for': ip } : {} });
const login = (username: string, password: string, ip = '10.0.0.1') =>
  loginRoute.POST(post('/api/auth/login', { username, password }, ip));

describe('login throttling', () => {
  it('11th failed attempt for a username → 429 with retry-after, without running argon2', async () => {
    for (let i = 0; i < 10; i++) expect((await login(studentName, 'wrong-pass', `10.0.1.${i}`)).status).toBe(401);
    verifySpy.mockClear();
    const res = await login(studentName, 'wrong-pass', '10.0.1.200');
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(verifySpy).not.toHaveBeenCalled();
    // Even the right password is refused while locked out.
    expect((await login(studentName, SEED_PASSWORD, '10.0.1.201')).status).toBe(429);
  });

  it('the username key is normalized (case/space)', async () => {
    for (let i = 0; i < 10; i++) await login(i % 2 ? studentName.toUpperCase() : ` ${studentName} `, 'wrong-pass', `10.0.2.${i}`);
    expect((await login(studentName, 'wrong-pass', '10.0.2.99')).status).toBe(429);
  });

  it('successful logins do not count toward the per-username limit', async () => {
    for (let i = 0; i < 15; i++) expect((await login(studentName, SEED_PASSWORD, `10.0.4.${i}`)).status).toBe(200);
    expect((await login(studentName, 'wrong-pass', '10.0.4.99')).status).toBe(401);
  });

  it('successful logins never consume the per-IP budget: 150 successes from one IP all succeed', async () => {
    for (let i = 0; i < 150; i++) expect((await login(studentName, SEED_PASSWORD, '10.8.8.8')).status).toBe(200);
  });

  it('100 failures across usernames from one IP → the 101st attempt is 429, even with interleaved successes', async () => {
    for (let i = 0; i < 100; i++) {
      expect((await login(`nobody_${i}`, 'wrong-pass', '10.9.9.9')).status).toBe(401);
      if (i % 10 === 0) expect((await login(studentName, SEED_PASSWORD, '10.9.9.9')).status).toBe(200);
    }
    verifySpy.mockClear();
    expect((await login('nobody_x', 'wrong-pass', '10.9.9.9')).status).toBe(429);
    expect((await login(studentName, SEED_PASSWORD, '10.9.9.9')).status).toBe(429);
    expect(verifySpy).not.toHaveBeenCalled();
    expect((await login(studentName, SEED_PASSWORD, '10.9.9.10')).status).toBe(200);
  });

  it('a concurrent burst of 120 failing logins across usernames from one IP: at most 100 reach password verification', async () => {
    verifySpy.mockClear();
    const res = await Promise.all(Array.from({ length: 120 }, (_, i) => login(`burst_${i}`, 'wrong-pass', '10.7.7.7')));
    expect(res.filter((r) => r.status === 401)).toHaveLength(100);
    expect(res.filter((r) => r.status === 429)).toHaveLength(20);
    expect(verifySpy.mock.calls.length).toBeLessThanOrEqual(100);
  });

  it('limits are env-configurable', async () => {
    vi.stubEnv('RATE_LIMIT_LOGIN_USER', '2');
    try {
      await login(studentName, 'x-wrong', '10.0.3.1');
      await login(studentName, 'x-wrong', '10.0.3.2');
      expect((await login(studentName, 'x-wrong', '10.0.3.3')).status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('join throttling', () => {
  it('GET /api/join/username: 61st lookup per IP → 429', async () => {
    for (let i = 0; i < 60; i++) expect((await joinUsernameRoute.GET(get('/api/join/username?u=free.name', '10.1.0.1'))).status).toBe(200);
    const res = await joinUsernameRoute.GET(get('/api/join/username?u=free.name', '10.1.0.1'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect((await joinUsernameRoute.GET(get('/api/join/username?u=free.name', '10.1.0.2'))).status).toBe(200);
  });

  it('GET /api/join/code/:code shares the per-IP lookup budget', async () => {
    const ctx = { params: Promise.resolve({ code: seed.a.code }) };
    for (let i = 0; i < 60; i++) expect((await joinCodeRoute.GET(get('/api/join/code/x', '10.1.1.1'), ctx)).status).toBe(200);
    expect((await joinCodeRoute.GET(get('/api/join/code/x', '10.1.1.1'), ctx)).status).toBe(429);
    expect((await joinUsernameRoute.GET(get('/api/join/username?u=free.name', '10.1.1.1'))).status).toBe(429);
  });

  it('POST /api/join: 21st attempt per IP per hour → 429', async () => {
    for (let i = 0; i < 20; i++) expect((await joinRoute.POST(post('/api/join', { bad: true }, '10.2.0.1'))).status).toBe(400);
    expect((await joinRoute.POST(post('/api/join', { bad: true }, '10.2.0.1'))).status).toBe(429);
    expect((await joinRoute.POST(post('/api/join', { bad: true }, '10.2.0.2'))).status).toBe(400);
  });

  it('POST /api/invite/:token: 21st attempt per IP per hour → 429', async () => {
    const ctx = { params: Promise.resolve({ token: 'nope' }) };
    for (let i = 0; i < 20; i++) expect((await inviteRoute.POST(post('/api/invite/nope', { bad: true }, '10.3.0.1'), ctx)).status).toBe(400);
    expect((await inviteRoute.POST(post('/api/invite/nope', { bad: true }, '10.3.0.1'), ctx)).status).toBe(429);
  });
});
