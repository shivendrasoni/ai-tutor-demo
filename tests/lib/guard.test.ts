import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPageAccess, requirePageActor } from '@/lib/guard';
import { login } from '@/modules/tenancy';
import type { Actor } from '@/modules/tenancy';
import { resetDb, seedTwoSchools, SEED_PASSWORD, type Seed } from '../helpers/db';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'sid' && cookieValue ? { name: n, value: cookieValue } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error('REDIRECT:' + url);
  },
}));

const base: Actor = { userId: 'u1', isPlatformAdmin: false, schoolId: 's1', branchId: 'b1', roles: [] };
const platformActor: Actor = { ...base, isPlatformAdmin: true };
const teacherActor: Actor = { ...base, roles: ['teacher'] };
const studentActor: Actor = { ...base, roles: ['student'] };

describe('checkPageAccess', () => {
  it('no actor -> /login', () => expect(checkPageAccess(null, undefined, ['teacher'])).toEqual({ redirect: '/login' }));
  it('wrong role -> own home', () => expect(checkPageAccess(teacherActor, undefined, ['platform'])).toEqual({ redirect: '/teacher' }));
  it('matching role -> ok', () => expect(checkPageAccess(platformActor, undefined, ['platform'])).toEqual({ ok: true }));
  it('platform admin is not matched by role list without "platform"', () =>
    expect(checkPageAccess(platformActor, undefined, ['school_admin'])).toEqual({ redirect: '/platform' }));
  it('inactive student on a student page -> /status unless allowInactiveStudent', () => {
    expect(checkPageAccess(studentActor, 'pending_payment', ['student'])).toEqual({ redirect: '/status' });
    expect(checkPageAccess(studentActor, 'pending_payment', ['student'], { allowInactiveStudent: true })).toEqual({ ok: true });
    expect(checkPageAccess(studentActor, 'active', ['student'])).toEqual({ ok: true });
  });
  it('active student on a teacher page -> /learn', () =>
    expect(checkPageAccess(studentActor, 'active', ['teacher'])).toEqual({ redirect: '/learn' }));
});

describe('requirePageActor', () => {
  let seed: Seed;
  beforeAll(async () => {
    await resetDb();
    seed = await seedTwoSchools();
  });
  beforeEach(() => {
    cookieValue = undefined;
  });
  async function tokenFor(userId: string): Promise<string> {
    const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
    return (await login(u.username!, SEED_PASSWORD)).token;
  }

  it('redirects to /login when cookie is absent', async () => {
    await expect(requirePageActor(['teacher'])).rejects.toThrow('REDIRECT:/login');
  });
  it('returns the actor for a valid cookie and role', async () => {
    cookieValue = await tokenFor(seed.a.teacher.userId);
    expect((await requirePageActor(['teacher'])).userId).toBe(seed.a.teacher.userId);
  });
  it('redirects a wrong-role actor to their home', async () => {
    cookieValue = await tokenFor(seed.a.teacher.userId);
    await expect(requirePageActor(['school_admin'])).rejects.toThrow('REDIRECT:/teacher');
  });
  it('seeded student (pending or active) is routed by status', async () => {
    cookieValue = await tokenFor(seed.a.student.userId);
    const out = await requirePageActor(['student'], { allowInactiveStudent: true });
    expect(out.userId).toBe(seed.a.student.userId);
  });
});
