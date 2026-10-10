import { expect, test } from '@playwright/test';
import { login, paymentAmounts, seedDashboardWorld } from './helpers/seed';

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
  // Before payment the student is only pending: login lands on /status, so /learn later proves activation.
  const pendingCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const pending = await pendingCtx.newPage();
    await login(pending, world.pendingStudent);
    await expect(pending).toHaveURL(/\/status$/);
  } finally {
    await pendingCtx.close();
  }

  await login(page, world.platform);
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/platform/payments');
  const row = page.getByRole('row', { name: new RegExp(world.pendingStudent.username) });
  await expect(row.getByLabel(/Amount/)).toHaveValue('499.00'); // prefilled from the plan price
  await row.getByLabel(/Amount/).fill('450.50'); // typed amount differs from the plan price
  await row.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(world.pendingStudent.username)).toHaveCount(0); // left the pending queue
  expect(await paymentAmounts(world.seed.a.subscriptionId)).toEqual([45050]); // the typed amount, not the plan price

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

test('school admin sets up a section and a teacher; the teacher logs in and sees the class on /teacher', async ({ page, browser }) => {
  await login(page, world.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);

  const sectionForm = page.getByRole('form', { name: 'Add a section' });
  await sectionForm.getByLabel('Grade').selectOption('9');
  await sectionForm.getByLabel('Section name').fill('9-Z');
  await sectionForm.getByRole('button', { name: 'Add section' }).click();
  await expect(sectionForm.getByRole('status')).toHaveText('Section added.');

  const teacherForm = page.getByRole('form', { name: 'Create a teacher account' });
  await teacherForm.getByLabel('Teacher name').fill('Setup Teacher');
  await teacherForm.getByLabel('Teacher username').fill('setup.teacher');
  await teacherForm.getByLabel('Teacher password').fill('setup-teacher-pass-1');
  await teacherForm.getByRole('button', { name: 'Create teacher' }).click();
  await expect(teacherForm.getByRole('status')).toContainText('Teacher account created');
  await expect(page.getByText('setup-teacher-pass-1')).toHaveCount(0); // the password is never echoed

  // router.refresh() brings the new teacher and section into the assign form.
  const assignForm = page.getByRole('form', { name: 'Assign a teacher' });
  await assignForm.getByLabel('Teacher').selectOption({ label: 'Setup Teacher (setup.teacher, Branch A)' });
  await assignForm.getByLabel('Section').selectOption({ label: '9 9-Z' });
  await assignForm.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await assignForm.getByRole('button', { name: 'Assign' }).click();
  await expect(assignForm.getByRole('status')).toHaveText('Teacher assigned.');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const teacher = await ctx.newPage();
    await login(teacher, { username: 'setup.teacher', password: 'setup-teacher-pass-1' });
    await expect(teacher).toHaveURL(/\/teacher/);
    await expect(teacher.getByText('9-Z · Mathematics')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
