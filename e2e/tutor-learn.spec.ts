import { expect, test } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { createPlan, listPendingSubscriptions, recordPayment, signupWithCode } from '@/modules/enrollment';
import { createBranch, createSchool, createSection, type Actor } from '@/modules/tenancy';
import { seedSkills } from '@/modules/tutor/skills';
import { resetDb } from '../tests/helpers/db';

test.use({ viewport: { width: 390, height: 844 } });

const PASSWORD = 'e2e-learner-password';

test.beforeAll(async () => {
  await resetDb();
  const [admin] = await withPlatform((tx) =>
    tx.insert(users).values({ username: 'e2e_platform', name: 'E2E Platform', isPlatformAdmin: true }).returning(),
  );
  const platform: Actor = { userId: admin.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };
  const school = await createSchool(platform, { name: 'Sunrise Public School', board: 'CBSE' });
  const branch = await createBranch(platform, { schoolId: school.id, name: 'Whitefield' });
  await createSection(platform, { branchId: branch.id, grade: 8, name: '8-A' });
  const plan = await createPlan(platform, { name: 'Monthly', interval: 'monthly', priceMinor: 49900 });
  await seedSkills();
  await signupWithCode({
    code: branch.signupCode, grade: 8, studentName: 'Learner', parentName: 'Parent', parentPhone: '9876543210',
    planId: plan.id, username: 'e2e_learner', password: PASSWORD,
  });
  const row = (await listPendingSubscriptions(platform)).find((p) => p.username === 'e2e_learner');
  await recordPayment(platform, { subscriptionId: row!.subscriptionId, amountMinor: 49900, currency: 'INR', paidAt: new Date() });
});

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

test('an active student lands on /learn and starts a new chat', async ({ page }) => {
  await page.goto('/learn');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Username').fill('e2e_learner');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/learn$/);

  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByLabel('Socratic')).toBeChecked();
  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page).toHaveURL(/\/learn\/c\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Your message')).toBeVisible();

  // /status sends an active student back to /learn
  await page.goto('/status');
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
});
