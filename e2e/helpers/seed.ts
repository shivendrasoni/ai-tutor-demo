import { eq } from 'drizzle-orm';
import { expect, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { payments, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { resetDb, SEED_PASSWORD, seedTwoSchools } from '../../tests/helpers/db';

export type Creds = { username: string; password: string };

const usernameOf = async (userId: string): Promise<string> => {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
};

/**
 * Resets the test DB and seeds school A (+ B) with the Monthly plan (499.00 INR). Every seeded user logs in
 * with SEED_PASSWORD. `pendingStudent` has a pending subscription; `removableStudent` is a second, separate
 * pending student signed up through the public signup path so removal never touches the pending-payment flow.
 */
export async function seedDashboardWorld() {
  await resetDb();
  const seed = await seedTwoSchools();
  const removable = await signupWithCode({
    code: seed.a.code,
    grade: 8,
    studentName: 'Removable Kid',
    parentName: 'Removable Parent',
    parentPhone: '9000000001',
    planId: seed.planId,
    username: 'removable.kid',
    password: SEED_PASSWORD,
  });
  const creds = async (userId: string): Promise<Creds> => ({ username: await usernameOf(userId), password: SEED_PASSWORD });
  return {
    seed,
    platform: await creds(seed.platform.userId!),
    schoolAdmin: await creds(seed.a.schoolAdmin.userId!),
    pendingStudent: await creds(seed.a.studentId),
    removableStudent: await creds(removable.studentUserId),
  };
}

export async function login(page: Page, c: Creds): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(c.username);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

export { expect };

/** Amounts (minor units) of every payment recorded for the subscription. */
export async function paymentAmounts(subscriptionId: string): Promise<number[]> {
  const rows = await withPlatform((tx) =>
    tx.select({ a: payments.amountMinor }).from(payments).where(eq(payments.subscriptionId, subscriptionId)),
  );
  return rows.map((r) => r.a);
}
