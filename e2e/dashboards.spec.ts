import { expect, test } from '@playwright/test';
import { login, seedDashboardWorld } from './helpers/seed';

/*
 * Dashboard flows. Each test re-seeds (resetDb + module helpers) so they are independent.
 * No closeDb(): Playwright reuses one worker process across spec files and the db pools are module-level.
 */

test.use({ viewport: { width: 390, height: 844 } });

let world: Awaited<ReturnType<typeof seedDashboardWorld>>;

test.beforeEach(async () => {
  world = await seedDashboardWorld();
});

test('platform admin records a payment (typed amount wins) and the student reaches /learn', async ({ page, browser }) => {
  await login(page, world.platform);
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/platform/payments');
  const row = page.getByRole('row', { name: new RegExp(world.pendingStudent.username) });
  await expect(row.getByLabel(/Amount/)).toHaveValue('499.00'); // prefilled from the plan price
  await row.getByLabel(/Amount/).fill('450.50'); // typed amount differs from the plan price
  await row.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(world.pendingStudent.username)).toHaveCount(0); // left the pending queue

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const student = await ctx.newPage();
    await login(student, world.pendingStudent);
    await expect(student).toHaveURL(/\/learn/);
  } finally {
    await ctx.close();
  }
});

test('school admin manually adds a student and sees the invite link', async ({ page }) => {
  await login(page, world.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  await page.getByLabel('Student name').fill('Kabir');
  await page.getByLabel('Parent name').fill('Kabir Parent');
  await page.getByLabel('Parent phone').fill('9876543210');
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\/[\w-]+/);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('school admin removes a student and that login is then rejected', async ({ page }) => {
  await login(page, world.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  page.once('dialog', (d) => d.accept());
  const row = page.getByRole('row', { name: new RegExp(world.removableStudent.username) });
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row.getByText('removed')).toBeVisible(); // removed rows stay listed with a badge

  const ctx = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const removed = await ctx.newPage();
    await login(removed, world.removableStudent);
    await expect(removed.getByText('This account is no longer active. Contact your school.')).toBeVisible();
    await expect(removed).toHaveURL(/\/login$/);
  } finally {
    await ctx.close();
  }
});

test('root and guards route by role', async ({ page }) => {
  await login(page, world.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/school$/);
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/school$/);
  await page.context().clearCookies();
  await page.goto('/teacher');
  await expect(page).toHaveURL(/\/login/);
});
