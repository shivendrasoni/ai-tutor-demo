import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { studentProfiles, subscriptions } from '@/db/schema';
import { studentScope } from '@/modules/content';
import { effectiveStudentStatus, recordPayment, studentStatus } from '@/modules/enrollment';
import { homeFor } from '@/lib/home';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

const DAY = 86_400_000;
const pay = (daysAgo: number) =>
  recordPayment(seed.platform, {
    subscriptionId: seed.a.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date(Date.now() - daysAgo * DAY),
  });
const rows = async () => {
  const [p] = await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, seed.a.studentId)));
  const [s] = await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, seed.a.subscriptionId)));
  return { profile: p.status, sub: s.status };
};

describe('read-time lapse (no cron run)', () => {
  it('a current period stays active everywhere', async () => {
    await pay(1);
    expect((await studentStatus(seed.a.student)).status).toBe('active');
    expect(await effectiveStudentStatus(seed.a.studentId)).toBe('active');
    await expect(studentScope(seed.a.student)).resolves.toMatchObject({ schoolId: seed.a.schoolId });
    expect(await rows()).toEqual({ profile: 'active', sub: 'active' });
  });

  it('studentStatus reports lapsed for an expired period and flips the rows', async () => {
    await pay(40); // monthly: ended ~10 days ago
    expect(await rows()).toEqual({ profile: 'active', sub: 'active' });
    const s = await studentStatus(seed.a.student);
    expect(s.status).toBe('lapsed');
    expect(s.planName).toBe('Monthly');
    expect(await rows()).toEqual({ profile: 'lapsed', sub: 'lapsed' });
    expect(homeFor(seed.a.student, s.status)).toBe('/status');
  });

  it('studentScope is FORBIDDEN for an expired-but-not-yet-lapsed student, and flips the rows', async () => {
    await pay(40);
    await expect(studentScope(seed.a.student)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rows()).toEqual({ profile: 'lapsed', sub: 'lapsed' });
  });

  it('only the expired student is flipped (other school untouched)', async () => {
    await pay(40);
    await recordPayment(seed.platform, {
      subscriptionId: seed.b.subscriptionId, amountMinor: 1, currency: 'INR', paidAt: new Date(Date.now() - 40 * DAY),
    });
    await studentStatus(seed.a.student);
    const [pb] = await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, seed.b.studentId)));
    expect(pb.status).toBe('active');
  });

  it('paying again after a read-time lapse reactivates', async () => {
    await pay(40);
    expect((await studentStatus(seed.a.student)).status).toBe('lapsed');
    await pay(0);
    expect((await studentStatus(seed.a.student)).status).toBe('active');
    await expect(studentScope(seed.a.student)).resolves.toBeTruthy();
  });

  it('effectiveStudentStatus honours an injectable now and ignores non-active students', async () => {
    await pay(1);
    expect(await effectiveStudentStatus(seed.a.studentId, new Date(Date.now() + 60 * DAY))).toBe('lapsed');
    expect(await effectiveStudentStatus(seed.b.studentId)).toBe('pending_payment');
    expect(await effectiveStudentStatus('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
