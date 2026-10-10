import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { invites, memberships, plans, studentProfiles, subscriptions, users } from '@/db/schema';
import { completeInvite, getInvite, manualAddStudent, reissueInvite } from '@/modules/enrollment/invites';
import { login } from '@/modules/tenancy';
import { hashToken } from '@/modules/tenancy/auth/sessions';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
let input: Parameters<typeof manualAddStudent>[1];

beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  input = {
    branchId: seed.a.branchId,
    grade: 8,
    sectionId: seed.a.sectionId,
    studentName: 'Riya Sharma',
    parentName: 'Anita Sharma',
    parentPhone: '9876543210',
    parentEmail: 'anita@example.com',
  };
});
afterAll(closeDb);

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => e.code);

describe('manualAddStudent', () => {
  it('school_admin adds a pending_payment student with a 14-day invite', async () => {
    const r = await manualAddStudent(seed.a.schoolAdmin, input);
    expect(r.inviteUrl).toBe(`${process.env.APP_URL}/invite/${r.inviteToken}`);
    const [p] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(studentProfiles).where(eq(studentProfiles.userId, r.studentUserId)),
    );
    expect(p).toMatchObject({ status: 'pending_payment', branchId: seed.a.branchId, grade: 8, parentName: 'Anita Sharma' });
    const [m] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, r.studentUserId)),
    );
    expect(m).toMatchObject({ role: 'student', branchId: seed.a.branchId });
    const [u] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, r.studentUserId)));
    expect(u).toMatchObject({ username: null, passwordHash: null, name: 'Riya Sharma' });
    const [inv] = await withPlatform((tx) =>
      tx.select().from(invites).where(eq(invites.tokenHash, hashToken(r.inviteToken))),
    );
    const days = (inv.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(inv.usedAt).toBeNull();
  });

  it('branch_admin of the branch can add; teacher is FORBIDDEN', async () => {
    await expect(manualAddStudent(seed.a.branchAdmin, input)).resolves.toBeTruthy();
    expect(await codeOf(manualAddStudent(seed.a.teacher, input))).toBe('FORBIDDEN');
  });

  it('rejects a branch in another school', async () => {
    const code = await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, branchId: seed.b.branchId, sectionId: undefined }));
    expect(['NOT_FOUND', 'FORBIDDEN']).toContain(code);
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, branchId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('rejects bad input and a section from another branch', async () => {
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, studentName: ' ' }))).toBe('VALIDATION');
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, grade: 3 }))).toBe('VALIDATION');
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, sectionId: seed.b.sectionId }))).toBe('VALIDATION');
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, { ...input, grade: 9 }))).toBe('VALIDATION');
  });
});

describe('getInvite / completeInvite', () => {
  const creds = { username: 'riya.s', password: 'kid-password' };

  it('getInvite returns names', async () => {
    const { inviteToken } = await manualAddStudent(seed.a.schoolAdmin, input);
    expect(await getInvite(inviteToken)).toEqual({
      studentName: 'Riya Sharma', schoolName: 'School A', branchName: 'Branch A', grade: 8,
    });
    expect(await getInvite('unknown-token')).toBeNull();
  });

  it('completeInvite sets credentials, pending subscription, login works, second use is INVITE_INVALID', async () => {
    const { inviteToken, studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    const r = await completeInvite({ token: inviteToken, planId: seed.planId, ...creds });
    expect(r.studentUserId).toBe(studentUserId);
    const [sub] = await withTenant(seed.a.schoolId, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.id, r.subscriptionId)),
    );
    expect(sub).toMatchObject({ studentId: studentUserId, status: 'pending', planId: seed.planId });
    expect((await login('riya.s', creds.password)).actor.roles).toEqual(['student']);
    expect(await getInvite(inviteToken)).toBeNull();
    expect(await codeOf(completeInvite({ token: inviteToken, planId: seed.planId, username: 'other.one', password: 'kid-password' })))
      .toBe('INVITE_INVALID');
  });

  it('expired invite is INVITE_INVALID and getInvite null', async () => {
    const { inviteToken } = await manualAddStudent(seed.a.schoolAdmin, input);
    await withPlatform((tx) => tx.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await getInvite(inviteToken)).toBeNull();
    expect(await codeOf(completeInvite({ token: inviteToken, planId: seed.planId, ...creds }))).toBe('INVITE_INVALID');
  });

  it('removed student invite is INVITE_INVALID', async () => {
    const { inviteToken, studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    await withPlatform((tx) =>
      tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, studentUserId)),
    );
    expect(await getInvite(inviteToken)).toBeNull();
    expect(await codeOf(completeInvite({ token: inviteToken, planId: seed.planId, ...creds }))).toBe('INVITE_INVALID');
  });

  it('taken username does not consume the invite; retry succeeds', async () => {
    const { inviteToken } = await manualAddStudent(seed.a.schoolAdmin, input);
    await completeInvite({
      token: (await manualAddStudent(seed.a.schoolAdmin, input)).inviteToken, planId: seed.planId, ...creds,
    });
    const err = await completeInvite({ token: inviteToken, planId: seed.planId, ...creds }).catch((e) => e);
    expect(err.code).toBe('USERNAME_TAKEN');
    expect(err.details.suggestions).toHaveLength(3);
    expect(await getInvite(inviteToken)).not.toBeNull();
    await expect(
      completeInvite({ token: inviteToken, planId: seed.planId, username: 'riya.s2', password: 'kid-password' }),
    ).resolves.toBeTruthy();
  });

  it('rejects inactive or unknown plans and weak credentials without consuming', async () => {
    const { inviteToken } = await manualAddStudent(seed.a.schoolAdmin, input);
    const [inactive] = await withPlatform((tx) =>
      tx.insert(plans).values({ name: 'Old', interval: 'annual', priceMinor: 1, active: false }).returning(),
    );
    expect(await codeOf(completeInvite({ token: inviteToken, planId: inactive.id, ...creds }))).toBe('VALIDATION');
    expect(await codeOf(completeInvite({ token: inviteToken, planId: 'bad', ...creds }))).toBe('VALIDATION');
    expect(await codeOf(completeInvite({ token: inviteToken, planId: seed.planId, username: 'riya.s', password: 'x' })))
      .toBe('WEAK_PASSWORD');
    expect(await getInvite(inviteToken)).not.toBeNull();
  });

  it('concurrent completion: exactly one succeeds', async () => {
    const { inviteToken, studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    const results = await Promise.allSettled([
      completeInvite({ token: inviteToken, planId: seed.planId, username: 'twin.one', password: 'kid-password' }),
      completeInvite({ token: inviteToken, planId: seed.planId, username: 'twin.two', password: 'kid-password' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('INVITE_INVALID');
    const subs = await withTenant(seed.a.schoolId, (tx) => tx.select().from(subscriptions));
    expect(subs.filter((s) => s.studentId === studentUserId)).toHaveLength(1);
  });
});

describe('reissueInvite', () => {
  const tokenOf = (url: string) => url.split('/').pop()!;

  it('issues a fresh 14-day link, expires the old one, and the new one completes signup', async () => {
    const { studentUserId, inviteToken: oldToken } = await manualAddStudent(seed.a.schoolAdmin, input);
    const { inviteUrl } = await reissueInvite(seed.a.schoolAdmin, studentUserId);
    expect(inviteUrl).toMatch(new RegExp(`^${process.env.APP_URL}/invite/[A-Za-z0-9_-]+$`));
    const newToken = tokenOf(inviteUrl);
    expect(newToken).not.toBe(oldToken);
    expect(await getInvite(oldToken)).toBeNull();
    expect(await codeOf(completeInvite({ token: oldToken, planId: seed.planId, username: 'riya.old', password: 'kid-password' }))).toBe('INVITE_INVALID');
    expect(await getInvite(newToken)).toMatchObject({ studentName: 'Riya Sharma', grade: 8 });
    const [row] = await withPlatform((tx) => tx.select().from(invites).where(eq(invites.tokenHash, hashToken(newToken))));
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(13.9 * 86_400_000);
    expect(ttl).toBeLessThanOrEqual(14 * 86_400_000);
    await completeInvite({ token: newToken, planId: seed.planId, username: 'riya.new', password: 'kid-password' });
    expect((await login('riya.new', 'kid-password')).actor.userId).toBe(studentUserId);
  });

  it('works when the old invite already expired, and leaves exactly one live invite', async () => {
    const { studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    await withPlatform((tx) => tx.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }));
    const { inviteUrl } = await reissueInvite(seed.a.schoolAdmin, studentUserId);
    expect(await getInvite(tokenOf(inviteUrl))).not.toBeNull();
    const all = await withPlatform((tx) => tx.select().from(invites).where(eq(invites.studentUserId, studentUserId)));
    expect(all.filter((i) => !i.usedAt && i.expiresAt.getTime() > Date.now())).toHaveLength(1);
  });

  it('branch admin of the branch can; teacher and student cannot', async () => {
    const { studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    await expect(reissueInvite(seed.a.branchAdmin, studentUserId)).resolves.toBeTruthy();
    expect(await codeOf(reissueInvite(seed.a.teacher, studentUserId))).toBe('FORBIDDEN');
    expect(await codeOf(reissueInvite(seed.a.student, studentUserId))).toBe('FORBIDDEN');
  });

  it('refuses students who already signed up, are removed, or are not students; bad ids are NOT_FOUND', async () => {
    // Seeded student already has a username.
    expect(await codeOf(reissueInvite(seed.a.schoolAdmin, seed.a.studentId))).toBe('VALIDATION');
    const { studentUserId } = await manualAddStudent(seed.a.schoolAdmin, input);
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, studentUserId)));
    expect(await codeOf(reissueInvite(seed.a.schoolAdmin, studentUserId))).toBe('VALIDATION');
    expect(await codeOf(reissueInvite(seed.a.schoolAdmin, seed.a.teacherId))).toBe('NOT_FOUND');
    expect(await codeOf(reissueInvite(seed.a.schoolAdmin, 'nope'))).toBe('NOT_FOUND');
  });

  it('a student of another school is invisible (NOT_FOUND) and nothing changes', async () => {
    const { studentUserId } = await manualAddStudent(seed.b.schoolAdmin, { ...input, branchId: seed.b.branchId, sectionId: seed.b.sectionId });
    const before = await withPlatform((tx) => tx.select().from(invites));
    expect(await codeOf(reissueInvite(seed.a.schoolAdmin, studentUserId))).toBe('NOT_FOUND');
    expect(await codeOf(reissueInvite(seed.a.branchAdmin, studentUserId))).toBe('NOT_FOUND');
    expect(await withPlatform((tx) => tx.select().from(invites))).toEqual(before);
  });
});
