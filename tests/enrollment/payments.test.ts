import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { payments, studentProfiles, subscriptions } from '@/db/schema';
import { lapseExpired } from '@/modules/enrollment/lapse';
import { removeStudent } from '@/modules/enrollment/students';
import { DomainError } from '@/lib/errors';
import { listPendingSubscriptions, recordPayment } from '@/modules/enrollment/payments';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

// `now` defaults to the payment date itself (so fixed 2027 dates stay inside the date bounds).
const pay = (paidAt: string, over: Record<string, unknown> = {}, sub = seed.a.subscriptionId, now?: Date) =>
  recordPayment(
    seed.platform,
    { subscriptionId: sub, amountMinor: 49900, currency: 'INR', paidAt: new Date(paidAt), ...over },
    now ?? new Date(paidAt),
  );
const profileStatus = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, id))))[0].status;
const subRow = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, id))))[0];
const paymentCount = async () => (await withPlatform((tx) => tx.select().from(payments))).length;
const setProfile = (id: string, status: string) =>
  withPlatform((tx) => tx.update(studentProfiles).set({ status }).where(eq(studentProfiles.userId, id)));
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => e.code);

describe('recordPayment vs removeStudent concurrency', () => {
  it('never deadlocks and always ends removed + cancelled', async () => {
    for (let round = 0; round < 10; round++) {
      if (round > 0) {
        await resetDb();
        seed = await seedTwoSchools();
      }
      const [removal, payment] = await Promise.allSettled([
        removeStudent(seed.a.schoolAdmin, seed.a.studentId),
        pay('2026-10-01T00:00:00.000Z'),
      ]);
      expect(removal.status, `round ${round}: ${removal.status === 'rejected' ? (removal.reason as Error).message : ''}`).toBe('fulfilled');
      if (payment.status === 'rejected') {
        expect(payment.reason).toBeInstanceOf(DomainError);
        expect((payment.reason as DomainError).code).toBe('STUDENT_REMOVED');
      }
      expect(await profileStatus(seed.a.studentId)).toBe('removed');
      expect((await subRow(seed.a.subscriptionId)).status).toBe('cancelled');
    }
    // 10 rounds of reset + seed (argon2 hashing) + a race: inherently slow, so give it room under CPU load.
  }, 60_000);
});

describe('recordPayment', () => {
  it('amountMinor is capped at int4 max', async () => {
    expect(await codeOf(pay('2026-10-01T00:00:00Z', { amountMinor: 2147483648 }))).toBe('VALIDATION');
    expect(await paymentCount()).toBe(0);
    expect(await codeOf(pay('2026-10-01T00:00:00Z', { amountMinor: 2147483647 }))).toBe('ok');
  });

  it('first payment activates from paidAt', async () => {
    const r = await pay('2027-01-31T00:00:00Z');
    expect(r.periodStart.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(await profileStatus(seed.a.studentId)).toBe('active');
    const sub = await subRow(seed.a.subscriptionId);
    expect(sub.status).toBe('active');
    const [p] = await withPlatform((tx) => tx.select().from(payments));
    expect(p).toMatchObject({
      method: 'manual_link', recordedBy: seed.platform.userId, schoolId: seed.a.schoolId, externalRef: null,
    });
  });

  it('stores externalRef', async () => {
    await pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-123' });
    const [p] = await withPlatform((tx) => tx.select().from(payments));
    expect(p.externalRef).toBe('UPI-123');
  });

  it('payment while active extends from current end', async () => {
    await pay('2027-01-31T00:00:00Z');
    const r = await pay('2027-02-10T00:00:00Z');
    expect(r.periodStart.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2027-03-28T00:00:00.000Z');
  });

  it('lapse then pay restarts from paidAt', async () => {
    await pay('2027-01-31T00:00:00Z');
    expect(await lapseExpired(new Date('2027-03-01T00:00:00Z'))).toBe(1);
    expect(await profileStatus(seed.a.studentId)).toBe('lapsed');
    const r = await pay('2027-04-10T00:00:00Z');
    expect(r.periodStart.toISOString()).toBe('2027-04-10T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2027-05-10T00:00:00.000Z');
    expect(await profileStatus(seed.a.studentId)).toBe('active');
    expect((await subRow(seed.a.subscriptionId)).status).toBe('active');
  });

  it('active but already expired (lapse job not run) restarts from paidAt', async () => {
    await pay('2027-01-31T00:00:00Z'); // ends 2027-02-28
    const r = await pay('2027-04-10T00:00:00Z');
    expect(r.periodStart.toISOString()).toBe('2027-04-10T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2027-05-10T00:00:00.000Z');
  });

  it('rejects non-platform actors', async () => {
    const p = recordPayment(seed.a.schoolAdmin, {
      subscriptionId: seed.a.subscriptionId, amountMinor: 49900, currency: 'INR', paidAt: new Date(),
    });
    await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await paymentCount()).toBe(0);
  });

  it('rejects removed students without inserting a payment', async () => {
    await setProfile(seed.a.studentId, 'removed');
    expect(await codeOf(pay('2027-01-31T00:00:00Z'))).toBe('STUDENT_REMOVED');
    expect(await paymentCount()).toBe(0);
  });

  it('cancelled subscription on a non-removed profile is VALIDATION', async () => {
    await withPlatform((tx) =>
      tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, seed.a.subscriptionId)),
    );
    expect(await codeOf(pay('2027-01-31T00:00:00Z'))).toBe('VALIDATION');
    expect(await paymentCount()).toBe(0);
  });

  it('unknown or malformed subscription id is NOT_FOUND', async () => {
    expect(await codeOf(pay('2027-01-31T00:00:00Z', {}, '00000000-0000-4000-8000-000000000000'))).toBe('NOT_FOUND');
    expect(await codeOf(pay('2027-01-31T00:00:00Z', {}, 'nope'))).toBe('NOT_FOUND');
  });

  it('validates amount, currency, and paidAt', async () => {
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { amountMinor: 0 }))).toBe('VALIDATION');
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { amountMinor: 1.5 }))).toBe('VALIDATION');
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { currency: 'inr' }))).toBe('VALIDATION');
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { paidAt: new Date('x') }))).toBe('VALIDATION');
    expect(await paymentCount()).toBe(0);
  });

  it('serializes concurrent payments on one subscription', async () => {
    const [r1, r2] = await Promise.all([pay('2027-01-31T00:00:00Z'), pay('2027-01-31T00:00:00Z')]);
    const ends = [r1.periodEnd, r2.periodEnd].map((d) => d.toISOString()).sort();
    expect(ends).toEqual(['2027-02-28T00:00:00.000Z', '2027-03-28T00:00:00.000Z']);
    const sub = await subRow(seed.a.subscriptionId);
    expect(sub.currentPeriodStart!.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(sub.currentPeriodEnd!.toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(await paymentCount()).toBe(2);
  });
});

describe('recordPayment idempotency and date bounds', () => {
  it('a repeated externalRef on the same subscription is VALIDATION duplicate_payment and records nothing', async () => {
    await pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-9' });
    const err = await pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-9' }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('This payment reference was already recorded');
    expect(err.details).toEqual({ reason: 'duplicate_payment' });
    expect(await paymentCount()).toBe(1);
    expect((await subRow(seed.a.subscriptionId)).currentPeriodEnd!.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('concurrent duplicate refs record exactly one payment', async () => {
    const r = await Promise.all([
      codeOf(pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-C' })),
      codeOf(pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-C' })),
    ]);
    expect(r.sort()).toEqual(['VALIDATION', 'ok']);
    expect(await paymentCount()).toBe(1);
  });

  it('the same ref on another subscription is fine, and payments without a ref never collide', async () => {
    await pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-9' });
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { externalRef: 'UPI-9' }, seed.b.subscriptionId))).toBe('ok');
    expect(await codeOf(pay('2027-02-01T00:00:00Z'))).toBe('ok');
    expect(await codeOf(pay('2027-02-02T00:00:00Z'))).toBe('ok');
  });

  it('trims externalRef: whitespace-only is VALIDATION and "REF1 " duplicates "REF1"', async () => {
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { externalRef: '   ' }))).toBe('VALIDATION');
    expect(await paymentCount()).toBe(0);
    await pay('2027-01-31T00:00:00Z', { externalRef: 'REF1' });
    const err = await pay('2027-01-31T00:00:00Z', { externalRef: 'REF1 ' }).catch((e) => e);
    expect(err.details).toEqual({ reason: 'duplicate_payment' });
    await pay('2027-02-01T00:00:00Z', { externalRef: ' REF2 ' });
    const rows = await withPlatform((tx) => tx.select().from(payments));
    expect(rows.map((r) => r.externalRef).sort()).toEqual(['REF1', 'REF2']);
  });

  it('a payment exactly at the period end extends from the existing end', async () => {
    await pay('2027-01-31T00:00:00Z'); // ends 2027-02-28
    const r = await pay('2027-02-28T00:00:00Z');
    expect(r.periodStart.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2027-03-28T00:00:00.000Z');
  });

  it('a malformed subscription id is NOT_FOUND even with an invalid paidAt', async () => {
    expect(await codeOf(pay('2027-01-31T00:00:00Z', { paidAt: new Date('x') }, 'nope'))).toBe('NOT_FOUND');
  });

  it('rejects a paidAt more than 5 minutes in the future (service level, so the CLI is covered)', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(await codeOf(pay('2026-10-10T12:05:01Z', {}, seed.a.subscriptionId, now))).toBe('VALIDATION');
    expect(await codeOf(pay('2026-10-10T12:05:00Z', {}, seed.a.subscriptionId, now))).toBe('ok');
    expect(await codeOf(pay('2030-01-01T00:00:00Z', {}, seed.b.subscriptionId, now))).toBe('VALIDATION');
    expect(await paymentCount()).toBe(1);
  });

  it('rejects a paidAt older than one year', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(await codeOf(pay('2025-10-10T11:59:59Z', {}, seed.a.subscriptionId, now))).toBe('VALIDATION');
    expect(await codeOf(pay('2025-10-10T12:00:00Z', {}, seed.a.subscriptionId, now))).toBe('ok');
  });
});

describe('listPendingSubscriptions', () => {
  it('lists pending and lapsed, excluding removed and active', async () => {
    let rows = await listPendingSubscriptions(seed.platform);
    expect(rows).toHaveLength(2);
    const rowA = rows.find((r) => r.subscriptionId === seed.a.subscriptionId)!;
    expect(rowA).toMatchObject({
      subscriptionId: seed.a.subscriptionId, status: 'pending', studentName: 'student A',
      schoolName: 'School A', branchName: 'Branch A', grade: 8, parentName: 'Parent A',
      parentPhone: '9999999999', planName: 'Monthly', priceMinor: 49900, currency: 'INR',
    });
    expect(rowA.username).toMatch(/^student_a_[0-9a-f]{8}$/);
    expect(rowA.createdAt).toBeInstanceOf(Date);

    await pay('2027-01-31T00:00:00Z');
    rows = await listPendingSubscriptions(seed.platform);
    expect(rows.map((r) => r.subscriptionId)).toEqual([seed.b.subscriptionId]);

    await lapseExpired(new Date('2027-03-01T00:00:00Z'));
    rows = await listPendingSubscriptions(seed.platform);
    expect(rows.map((r) => r.subscriptionId).sort()).toEqual([seed.a.subscriptionId, seed.b.subscriptionId].sort());
    expect(rows.find((r) => r.subscriptionId === seed.a.subscriptionId)!.status).toBe('lapsed');

    await setProfile(seed.b.studentId, 'removed');
    rows = await listPendingSubscriptions(seed.platform);
    expect(rows.map((r) => r.subscriptionId)).toEqual([seed.a.subscriptionId]);
  });

  it('rejects non-platform actors', async () => {
    await expect(listPendingSubscriptions(seed.a.schoolAdmin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('lapseExpired', () => {
  it('lapses only expired active subscriptions and is idempotent', async () => {
    await pay('2027-01-31T00:00:00Z'); // A ends 2027-02-28
    await pay('2027-02-15T00:00:00Z', {}, seed.b.subscriptionId); // B ends 2027-03-15
    expect(await lapseExpired(new Date('2027-03-01T00:00:00Z'))).toBe(1);
    expect(await lapseExpired(new Date('2027-03-01T00:00:00Z'))).toBe(0);
    expect(await profileStatus(seed.a.studentId)).toBe('lapsed');
    expect(await profileStatus(seed.b.studentId)).toBe('active');
    expect((await subRow(seed.b.subscriptionId)).status).toBe('active');
  });

  it('does not lapse when end equals now, nor touch pending or removed', async () => {
    await pay('2027-01-31T00:00:00Z');
    expect(await lapseExpired(new Date('2027-02-28T00:00:00Z'))).toBe(0);
    await setProfile(seed.a.studentId, 'removed');
    await withPlatform((tx) =>
      tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, seed.a.subscriptionId)),
    );
    expect(await lapseExpired(new Date('2030-01-01T00:00:00Z'))).toBe(0);
    expect(await profileStatus(seed.a.studentId)).toBe('removed');
    expect((await subRow(seed.b.subscriptionId)).status).toBe('pending');
    expect(await profileStatus(seed.b.studentId)).toBe('pending_payment');
  });
});
