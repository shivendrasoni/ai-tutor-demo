import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { memberships, sessions, studentProfiles, users } from '@/db/schema';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { assertPasswordStrength, hashPassword, verifyPassword } from '@/modules/tenancy/auth/passwords';
import { assertValidUsername, normalizeUsername, suggestUsernames } from '@/modules/tenancy/auth/usernames';
import { createSession, revokeUserSessions } from '@/modules/tenancy/auth/sessions';
import { login } from '@/modules/tenancy/auth/login';
import { resolveActor } from '@/modules/tenancy/actor';

const PW = 'correct-horse';
let seed: Seed;
let adminId: string;
let platformId: string;

async function mkStudent(username: string, status: string, hash: string | null) {
  return withPlatform(async (tx) => {
    const [u] = await tx.insert(users).values({ username, name: username, passwordHash: hash }).returning();
    await tx.insert(memberships).values({
      userId: u.id, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'student',
    });
    await tx.insert(studentProfiles).values({
      userId: u.id, schoolId: seed.a.schoolId, branchId: seed.a.branchId, grade: 8,
      parentName: 'P', parentPhone: '9999999999', status,
    });
    return u.id;
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  const hash = await hashPassword(PW);
  await mkStudent('riya.s', 'active', hash);
  await mkStudent('riya.s1', 'active', hash);
  await mkStudent('removed.kid', 'removed', hash);
  await mkStudent('nopass.kid', 'active', null);
  adminId = await withPlatform(async (tx) => {
    const [u] = await tx.insert(users).values({ username: 'admin.a', name: 'Admin', passwordHash: hash }).returning();
    await tx.insert(memberships).values({ userId: u.id, schoolId: seed.a.schoolId, branchId: null, role: 'school_admin' });
    return u.id;
  });
  platformId = seed.platform.userId;
  await withPlatform((tx) => tx.update(users).set({ username: 'plat.admin', passwordHash: hash }).where(eq(users.id, platformId)));
});
afterAll(closeDb);

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, 'wrong-pass')).toBe(false);
  });
  it('rejects weak passwords', () => {
    expect(() => assertPasswordStrength('short')).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
    expect(() => assertPasswordStrength('x'.repeat(129))).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
    expect(() => assertPasswordStrength('x'.repeat(8))).not.toThrow();
    expect(() => assertPasswordStrength('x'.repeat(128))).not.toThrow();
  });
});

describe('usernames', () => {
  it('normalizes and validates', () => {
    expect(normalizeUsername('  Riya.S ')).toBe('riya.s');
    expect(() => assertValidUsername('ab')).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
    expect(() => assertValidUsername('has space')).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
    expect(() => assertValidUsername('x'.repeat(33))).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
    expect(() => assertValidUsername('ok_name.1')).not.toThrow();
  });
  it('suggests free usernames', async () => {
    expect(await withPlatform((tx) => suggestUsernames(tx, 'riya.s'))).toEqual(['riya.s2', 'riya.s3', 'riya.s4']);
    expect(await withPlatform((tx) => suggestUsernames(tx, ' Riya.S ', 1))).toEqual(['riya.s2']);
  });
  it('truncates base to 29 chars', async () => {
    const out = await withPlatform((tx) => suggestUsernames(tx, 'a'.repeat(40), 1));
    expect(out).toEqual(['a'.repeat(29) + '1']);
  });
});

describe('login and resolveActor', () => {
  it('logs in case-insensitively and resolves actor', async () => {
    const { token, actor } = await login('  RIYA.S ', PW);
    expect(actor).toMatchObject({
      roles: ['student'], schoolId: seed.a.schoolId, branchId: seed.a.branchId, isPlatformAdmin: false,
    });
    expect(await resolveActor(token)).toEqual(actor);
  });
  it('school admin has null branch', async () => {
    const { actor } = await login('admin.a', PW);
    expect(actor).toEqual({
      userId: adminId, isPlatformAdmin: false, schoolId: seed.a.schoolId, branchId: null, roles: ['school_admin'],
    });
  });
  it('platform admin without membership', async () => {
    const { token, actor } = await login('plat.admin', PW);
    expect(actor).toEqual({ userId: platformId, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] });
    expect(await resolveActor(token)).toEqual(actor);
  });
  it('rejects wrong password, unknown user, null hash', async () => {
    await expect(login('riya.s', 'nope-nope')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(login('ghost.user', PW)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(login('nopass.kid', PW)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('removed students: ACCOUNT_REMOVED only after correct password', async () => {
    await expect(login('removed.kid', PW)).rejects.toMatchObject({ code: 'ACCOUNT_REMOVED' });
    await expect(login('removed.kid', 'nope-nope')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('removed after login resolves to null', async () => {
    const { token, actor } = await login('riya.s1', PW);
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, actor.userId)));
    expect(await resolveActor(token)).toBeNull();
  });
  it('stores only the hash of the token, 30 day TTL', async () => {
    const token = await createSession(adminId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, adminId)));
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    const row = rows.find((r) => r.tokenHash.length === 64)!;
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });
  it('expired sessions resolve to null', async () => {
    const token = await createSession(adminId);
    expect(await resolveActor(token)).not.toBeNull();
    await withPlatform((tx) => tx.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, adminId)));
    expect(await resolveActor(token)).toBeNull();
  });
  it('revoked sessions resolve to null', async () => {
    const { token, actor } = await login('riya.s', PW);
    await withPlatform((tx) => revokeUserSessions(tx, actor.userId));
    expect(await resolveActor(token)).toBeNull();
    expect(await resolveActor(undefined)).toBeNull();
    expect(await resolveActor('garbage')).toBeNull();
  });
});
