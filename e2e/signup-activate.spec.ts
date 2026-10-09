import { expect, test } from '@playwright/test';
import { closeDb, withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { createPlan, listPendingSubscriptions, recordPayment } from '@/modules/enrollment';
import { createBranch, createSchool, createSection, type Actor } from '@/modules/tenancy';
import { resetDb } from '../tests/helpers/db';

test.use({ viewport: { width: 390, height: 844 } });

let platform: Actor;
let code: string;

test.beforeAll(async () => {
  await resetDb();
  const [admin] = await withPlatform((tx) =>
    tx.insert(users).values({ username: 'e2e_platform', name: 'E2E Platform', isPlatformAdmin: true }).returning(),
  );
  platform = { userId: admin.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };
  const school = await createSchool(platform, { name: 'Sunrise Public School', board: 'CBSE' });
  const branch = await createBranch(platform, { schoolId: school.id, name: 'Whitefield' });
  await createSection(platform, { branchId: branch.id, grade: 8, name: '8-A' });
  await createPlan(platform, { name: 'Monthly', interval: 'monthly', priceMinor: 49900 });
  code = branch.signupCode;
});

test.afterAll(async () => {
  await closeDb();
});

test('signup with a branch code, log in while pending, then activate after payment', async ({ page }) => {
  // 1. Code entry
  await page.goto('/join');
  await page.getByLabel('Signup code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Joining Sunrise Public School — Whitefield')).toBeVisible();

  // 2. Signup form
  await page.getByLabel('Grade').selectOption('8');
  await page.getByLabel('Section (optional)').selectOption({ label: '8-A' });
  await page.getByLabel('Student name').fill('E2E Kid');
  await page.getByLabel('Parent name').fill('E2E Parent');
  await page.getByLabel('Parent phone').fill('9876543210');
  await page.getByLabel(/Monthly/).check();
  await page.getByLabel('Username').fill('E2E.Kid');
  await page.getByLabel('Password').fill('e2e-kid-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Account created')).toBeVisible();
  await expect(
    page.getByText("Account created. You'll be able to log in once your payment is confirmed."),
  ).toBeVisible();

  // 3. Log in (the username was normalised to lowercase)
  await page.goto('/login');
  await page.getByLabel('Username').fill('e2e.kid');
  await page.getByLabel('Password').fill('e2e-kid-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/status$/);
  await expect(
    page.getByText(
      "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.",
    ),
  ).toBeVisible();

  // 4. Record the payment as the platform admin, then reload
  const pending = await listPendingSubscriptions(platform);
  const row = pending.find((p) => p.username === 'e2e.kid');
  expect(row).toBeTruthy();
  await recordPayment(platform, {
    subscriptionId: row!.subscriptionId, amountMinor: 49900, currency: 'INR', paidAt: new Date(),
  });
  await page.reload();
  await expect(page.getByText('Your account is active.')).toBeVisible();
});
