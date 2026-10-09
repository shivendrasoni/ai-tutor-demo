import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { payments, sessions, studentProfiles, subscriptions, users } from '@/db/schema';
import { recordPayment } from '@/modules/enrollment/payments';
import { listStudents, removeStudent, studentStatus } from '@/modules/enrollment/students';
import { login, resolveActor } from '@/modules/tenancy';
import { createSession } from '@/modules/tenancy/auth/sessions';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

const profile = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, id))))[0];
const subOf = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.studentId, id))))[0];
const sessionCount = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, id)))).length;
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => e.code);

describe('listStudents', () => {
  it('school_admin lists own school, with StudentRow shape; status filter narrows', async () => {
    const rows = await listStudents(seed.a.schoolAdmin, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: seed.a.studentId, name: 'student A', username: expect.stringMatching(/^student_a_[0-9a-f]{8}$/),
      branchId: seed.a.branchId, branchName: 'Branch A', grade: 8, sectionName: '8-A',
      status: 'pending_payment', planName: 'Monthly', periodEnd: null,
    });
    expect(await listStudents(seed.a.schoolAdmin, { status: 'active' })).toHaveLength(0);
    expect(await listStudents(seed.a.schoolAdmin, { status: 'pending_payment', grade: 8 })).toHaveLength(1);
    expect(await listStudents(seed.a.schoolAdmin, { grade: 9 })).toHaveLength(0);
    expect(await listStudents(seed.a.schoolAdmin, { branchId: seed.a.branchId })).toHaveLength(1);
  });

  it('periodEnd populated after payment; null planName/sectionName when absent', async () => {
    await recordPayment(seed.platform, {
      subscriptionId: seed.a.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date('2027-01-10T00:00:00Z'),
    });
    await withPlatform((tx) => tx.update(studentProfiles).set({ sectionId: null }).where(eq(studentProfiles.userId, seed.a.studentId)));
    const [r] = await listStudents(seed.a.schoolAdmin, { status: 'active' });
    expect(r.periodEnd?.toISOString()).toBe('2027-02-10T00:00:00.000Z');
    expect(r.sectionName).toBeNull();
    await withPlatform(async (tx) => {
      await tx.delete(payments);
      await tx.delete(subscriptions).where(eq(subscriptions.studentId, seed.a.studentId));
    });
    const [r2] = await listStudents(seed.a.schoolAdmin, {});
    expect(r2.planName).toBeNull();
    expect(r2.periodEnd).toBeNull();
  });

  it('branch_admin sees own branch only; defaults branchId; other branch FORBIDDEN', async () => {
    expect((await listStudents(seed.a.branchAdmin, {})).map((r) => r.userId)).toEqual([seed.a.studentId]);
    expect(await codeOf(listStudents(seed.a.branchAdmin, { branchId: seed.b.branchId }))).toBe('FORBIDDEN');
  });

  it('teacher and student are FORBIDDEN', async () => {
    expect(await codeOf(listStudents(seed.a.teacher, {}))).toBe('FORBIDDEN');
    expect(await codeOf(listStudents(seed.a.student, {}))).toBe('FORBIDDEN');
  });

  it('school_admin cannot reach another school', async () => {
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { schoolId: seed.b.schoolId }))).toBe('FORBIDDEN');
    expect(await listStudents(seed.a.schoolAdmin, { branchId: seed.b.branchId })).toEqual([]);
    const own = await listStudents(seed.a.schoolAdmin, { schoolId: seed.a.schoolId });
    expect(own.map((x) => x.userId)).toEqual([seed.a.studentId]);
  });

  it('platform admin needs schoolId and is scoped to it', async () => {
    expect(await codeOf(listStudents(seed.platform, {}))).toBe('VALIDATION');
    expect((await listStudents(seed.platform, { schoolId: seed.b.schoolId })).map((r) => r.userId)).toEqual([seed.b.studentId]);
    expect(await listStudents(seed.platform, { schoolId: seed.a.schoolId, branchId: seed.b.branchId })).toEqual([]);
  });

  it('validates filters', async () => {
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { grade: 4 }))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { grade: 8.5 }))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { status: 'bogus' as never }))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.platform, { schoolId: 'nope' }))).toBe('VALIDATION');
  });
});

describe('removeStudent', () => {
  it('removes: token dead, login ACCOUNT_REMOVED, data kept, subscription cancelled', async () => {
    const username = (await withPlatform((tx) => tx.select().from(users).where(eq(users.id, seed.a.studentId))))[0].username!;
    const { token } = await login(username, SEED_PASSWORD);
    expect(await resolveActor(token)).not.toBeNull();

    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);

    expect(await resolveActor(token)).toBeNull();
    expect(await codeOf(login(username, SEED_PASSWORD))).toBe('ACCOUNT_REMOVED');
    expect((await profile(seed.a.studentId)).status).toBe('removed');
    expect((await subOf(seed.a.studentId)).status).toBe('cancelled');
    expect(await sessionCount(seed.a.studentId)).toBe(0);
  });

  it('is idempotent and revokes sessions each time', async () => {
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    await createSession(seed.a.studentId);
    expect(await sessionCount(seed.a.studentId)).toBe(1);
    await expect(removeStudent(seed.a.schoolAdmin, seed.a.studentId)).resolves.toBeUndefined();
    expect(await sessionCount(seed.a.studentId)).toBe(0);
    expect((await profile(seed.a.studentId)).status).toBe('removed');
  });

  it('works without a subscription', async () => {
    await withPlatform((tx) => tx.delete(subscriptions).where(eq(subscriptions.studentId, seed.a.studentId)));
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    expect((await profile(seed.a.studentId)).status).toBe('removed');
  });

  it('branch_admin may remove in own branch', async () => {
    await removeStudent(seed.a.branchAdmin, seed.a.studentId);
    expect((await profile(seed.a.studentId)).status).toBe('removed');
  });

  it('platform admin may remove', async () => {
    await removeStudent(seed.platform, seed.b.studentId);
    expect((await profile(seed.b.studentId)).status).toBe('removed');
  });

  it('teacher and student are FORBIDDEN; nothing changes', async () => {
    expect(await codeOf(removeStudent(seed.a.teacher, seed.a.studentId))).toBe('FORBIDDEN');
    expect(await codeOf(removeStudent(seed.a.student, seed.a.studentId))).toBe('FORBIDDEN');
    expect((await profile(seed.a.studentId)).status).toBe('pending_payment');
  });

  it('cross-school removal is NOT_FOUND and leaves B untouched', async () => {
    expect(await codeOf(removeStudent(seed.a.schoolAdmin, seed.b.studentId))).toBe('NOT_FOUND');
    expect(await codeOf(removeStudent(seed.a.branchAdmin, seed.b.studentId))).toBe('NOT_FOUND');
    expect((await profile(seed.b.studentId)).status).toBe('pending_payment');
    expect((await subOf(seed.b.studentId)).status).toBe('pending');
  });

  it('non-student ids and malformed ids are NOT_FOUND', async () => {
    expect(await codeOf(removeStudent(seed.a.schoolAdmin, seed.a.teacherId))).toBe('NOT_FOUND');
    expect(await codeOf(removeStudent(seed.a.schoolAdmin, 'not-a-uuid'))).toBe('NOT_FOUND');
  });

  it('recordPayment on a removed student is STUDENT_REMOVED', async () => {
    await withPlatform((tx) => tx.update(subscriptions).set({ status: 'pending' }).where(eq(subscriptions.studentId, seed.a.studentId)));
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, seed.a.studentId)));
    const p = recordPayment(seed.platform, {
      subscriptionId: seed.a.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date(),
    });
    expect(await codeOf(p)).toBe('STUDENT_REMOVED');
    // also via the real removal path
    await removeStudent(seed.a.schoolAdmin, seed.a.studentId);
    expect(await codeOf(recordPayment(seed.platform, {
      subscriptionId: seed.a.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date(),
    }))).toBe('STUDENT_REMOVED');
  });
});

describe('studentStatus', () => {
  it('returns pending status with plan name for a student', async () => {
    expect(await studentStatus(seed.a.student)).toEqual({ status: 'pending_payment', planName: 'Monthly', periodEnd: null });
  });

  it('returns periodEnd once active', async () => {
    await recordPayment(seed.platform, {
      subscriptionId: seed.a.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date('2027-01-10T00:00:00Z'),
    });
    const s = await studentStatus(seed.a.student);
    expect(s.status).toBe('active');
    expect(s.periodEnd?.toISOString()).toBe('2027-02-10T00:00:00.000Z');
  });

  it('non-students are FORBIDDEN', async () => {
    expect(await codeOf(studentStatus(seed.a.teacher))).toBe('FORBIDDEN');
    expect(await codeOf(studentStatus(seed.a.schoolAdmin))).toBe('FORBIDDEN');
    expect(await codeOf(studentStatus(seed.platform))).toBe('FORBIDDEN');
  });
});
