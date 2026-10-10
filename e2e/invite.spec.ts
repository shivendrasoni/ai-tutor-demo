import { expect, test } from '@playwright/test';
import { login, seedDashboardWorld } from './helpers/seed';

test.use({ viewport: { width: 390, height: 844 } });

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

test('school admin adds a student, the invite link sets credentials and lands on pending payment', async ({ page, browser }) => {
  const world = await seedDashboardWorld();
  await login(page, world.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  await page.getByLabel('Student name').fill('Invite Kid');
  await page.getByLabel('Parent name').fill('Invite Parent');
  await page.getByLabel('Parent phone').fill('9876543210');
  await page.getByRole('button', { name: 'Add student' }).click();
  const inviteUrl = await page.getByLabel('Invite link').inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[\w-]+$/);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const kid = await ctx.newPage();
    await kid.goto(new URL(inviteUrl).pathname);
    await expect(kid.getByRole('heading', { name: /Set up Invite Kid's account at/ })).toBeVisible();
    await kid.getByLabel(/Monthly/).check();
    await kid.getByLabel('Username').fill('Invite.Kid');
    await kid.getByLabel('Username').blur();
    await expect(kid.getByText('invite.kid is available.')).toBeVisible();
    await kid.getByLabel('Password').fill('invite-kid-password');
    await kid.getByRole('button', { name: 'Create account' }).click();
    await expect(
      kid.getByText("Account created. You'll be able to log in once your payment is confirmed."),
    ).toBeVisible();

    // The link is single-use.
    await kid.reload();
    await expect(kid.getByText('This invite link has expired or was already used. Ask your school for a new one.')).toBeVisible();

    await login(kid, { username: 'invite.kid', password: 'invite-kid-password' });
    await expect(kid).toHaveURL(/\/status$/);
    await expect(
      kid.getByText("Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning."),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});
