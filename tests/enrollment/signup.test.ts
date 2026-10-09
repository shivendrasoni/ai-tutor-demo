import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { memberships, plans, studentProfiles, subscriptions, users } from '@/db/schema';
import { currentCode, resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { createBranch, createSection, login, rotateBranchCode, setBranchCodeEnabled } from '@/modules/tenancy';
import { checkUsername, signupWithCode, validateCredentials } from '@/modules/enrollment/signup';
import { createPlan, listActivePlans } from '@/modules/enrollment/plans';
import { withUsernameTakenHandling } from '@/modules/tenancy/auth/credentials';
import { isUniqueViolation } from '@/db/pgerror';

let seed: Seed;
let valid: Parameters<typeof signupWithCode>[0];

beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  valid = {
    code: seed.a.code,
    grade: 8,
    sectionId: seed.a.sectionId,
    studentName: 'Riya Sharma',
    parentName: 'Anita Sharma',
    parentPhone: '9876543210',
    parentEmail: 'anita@example.com',
    planId: seed.planId,
    username: 'new.kid',
    password: 'kid-password',
  };
});
afterAll(closeDb);

describe('signupWithCode', () => {
  it('signs up a pending student with a normalized username', async () => {
    const r = await signupWithCode({ ...valid, code: seed.a.code.toLowerCase(), username: ' Riya.S ' });
    const p = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(studentProfiles).where(eq(studentProfiles.userId, r.studentUserId)),
    );
    expect(p[0]).toMatchObject({
      status: 'pending_payment', grade: 8, branchId: seed.a.branchId, sectionId: seed.a.sectionId,
      parentName: 'Anita Sharma', parentPhone: '9876543210', parentEmail: 'anita@example.com',
    });
    const [sub] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.id, r.subscriptionId)),
    );
    expect(sub).toMatchObject({ studentId: r.studentUserId, planId: seed.planId, status: 'pending', schoolId: seed.a.schoolId });
    const [m] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, r.studentUserId)),
    );
    expect(m).toMatchObject({ role: 'student', branchId: seed.a.branchId });
    const [u] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, r.studentUserId)));
    expect(u).toMatchObject({ username: 'riya.s', name: 'Riya Sharma', isPlatformAdmin: false });
    expect(u.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect((await login('riya.s', valid.password)).actor.roles).toEqual(['student']);
  });

  it('allows no section and no parent email', async () => {
    const { sectionId: _s, parentEmail: _e, ...rest } = valid;
    const r = await signupWithCode({ ...rest, grade: 10 });
    const [p] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(studentProfiles).where(eq(studentProfiles.userId, r.studentUserId)),
    );
    expect(p).toMatchObject({ grade: 10, sectionId: null, parentEmail: null });
  });

  it('rejects unknown codes', async () => {
    await expect(signupWithCode({ ...valid, code: 'NOPE2345' })).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });

  it('rejects rotated and disabled codes', async () => {
    const old = seed.a.code;
    await rotateBranchCode(seed.a.schoolAdmin, seed.a.branchId);
    await expect(signupWithCode({ ...valid, code: old })).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await setBranchCodeEnabled(seed.a.schoolAdmin, seed.a.branchId, false);
    const cur = await currentCode(seed.a.branchId);
    await expect(signupWithCode({ ...valid, code: cur })).rejects.toMatchObject({ code: 'CODE_DISABLED' });
  });

  it('rejects a section from another grade or branch', async () => {
    // other school's section
    await expect(signupWithCode({ ...valid, sectionId: seed.b.sectionId })).rejects.toMatchObject({ code: 'VALIDATION' });
    // grade mismatch
    await expect(signupWithCode({ ...valid, grade: 9 })).rejects.toMatchObject({ code: 'VALIDATION' });
    // another branch of the same school
    const other = await createBranch(seed.a.schoolAdmin, { schoolId: seed.a.schoolId, name: 'Other' });
    const { id: otherSection } = await createSection(seed.a.schoolAdmin, { branchId: other.id, grade: 8, name: '8-Z' });
    await expect(signupWithCode({ ...valid, sectionId: otherSection })).rejects.toMatchObject({ code: 'VALIDATION' });
    const n = await withPlatform((tx) => tx.select().from(users).where(eq(users.username, 'new.kid')));
    expect(n).toHaveLength(0);
  });

  it('rejects bad grade, bad plan, and invalid input with VALIDATION', async () => {
    const { sectionId: _s, ...noSection } = valid;
    for (const grade of [4, 13]) {
      await expect(signupWithCode({ ...noSection, grade })).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    await expect(signupWithCode({ ...valid, planId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const inactive = await withPlatform(async (tx) => {
      const [p] = await tx.insert(plans).values({ name: 'Old', interval: 'annual', priceMinor: 1, active: false }).returning();
      return p.id;
    });
    await expect(signupWithCode({ ...valid, planId: inactive })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(signupWithCode({ ...valid, parentPhone: '  ' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(signupWithCode({ ...valid, parentName: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(signupWithCode({ ...valid, parentEmail: 'not-an-email' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const err = await signupWithCode({ ...valid, studentName: '' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION', details: { issues: expect.any(Array) } });
  });

  it('rejects invalid usernames and weak passwords', async () => {
    await expect(signupWithCode({ ...valid, username: 'a b' })).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
    await expect(signupWithCode({ ...valid, password: 'short' })).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('a taken username gives USERNAME_TAKEN with 3 suggestions', async () => {
    await signupWithCode(valid);
    const err = await signupWithCode({ ...valid, username: 'NEW.KID', studentName: 'Other' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'USERNAME_TAKEN', details: { suggestions: ['new.kid1', 'new.kid2', 'new.kid3'] } });
  });

  it('concurrent duplicate usernames: one wins, other USERNAME_TAKEN with suggestions', async () => {
    const results = await Promise.allSettled([signupWithCode(valid), signupWithCode({ ...valid, studentName: 'Twin' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(rej.reason.details.suggestions).toHaveLength(3);
    const rows = await withPlatform((tx) => tx.select().from(users).where(eq(users.username, 'new.kid')));
    expect(rows).toHaveLength(1);
  });
});

describe('unique-violation race path', () => {
  it('a real 23505 on users_username_unique (no pre-check) becomes USERNAME_TAKEN', async () => {
    await signupWithCode(valid);
    const insertDup = () => withPlatform((tx) => tx.insert(users).values({ username: 'new.kid', name: 'Dup' }));
    const raw = await insertDup().catch((e) => e);
    expect(isUniqueViolation(raw, 'users_username_unique')).toBe(true);
    expect(isUniqueViolation(raw, 'branches_signup_code_unique')).toBe(false);
    const err = await withUsernameTakenHandling('new.kid', insertDup).catch((e) => e);
    expect(err).toMatchObject({ code: 'USERNAME_TAKEN', details: { suggestions: ['new.kid1', 'new.kid2', 'new.kid3'] } });
  });
});

describe('validateCredentials and checkUsername', () => {
  it('validateCredentials normalizes and validates', () => {
    expect(validateCredentials(' Riya.S ', 'long-enough')).toBe('riya.s');
    expect(() => validateCredentials('ab', 'long-enough')).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
    expect(() => validateCredentials('riya.s', 'short')).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
  });

  it('checkUsername reports availability and suggestions', async () => {
    expect(await checkUsername(' Fresh.Name ')).toEqual({ username: 'fresh.name', available: true, suggestions: [] });
    await signupWithCode(valid);
    expect(await checkUsername('New.Kid')).toEqual({
      username: 'new.kid', available: false, suggestions: ['new.kid1', 'new.kid2', 'new.kid3'],
    });
    await expect(checkUsername('x')).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
  });
});

describe('plans', () => {
  it('createPlan is platform only; listActivePlans hides inactive', async () => {
    await expect(
      createPlan(seed.a.schoolAdmin, { name: 'Annual', interval: 'annual', priceMinor: 499900 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { id } = await createPlan(seed.platform, { name: 'Annual', interval: 'annual', priceMinor: 499900 });
    await expect(
      createPlan(seed.platform, { name: 'Bad', interval: 'weekly' as never, priceMinor: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPlan(seed.platform, { name: 'Neg', interval: 'monthly', priceMinor: -1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await withPlatform((tx) => tx.insert(plans).values({ name: 'Old', interval: 'monthly', priceMinor: 1, active: false }));
    const active = await listActivePlans();
    expect(active.map((p) => p.id).sort()).toEqual([id, seed.planId].sort());
    expect(active.find((p) => p.id === id)).toMatchObject({ currency: 'INR', interval: 'annual', priceMinor: 499900 });
  });
});
