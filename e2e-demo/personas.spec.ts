import { expect, test } from '@playwright/test';

const VISITS: Record<string, string[]> = {
  student_junior: ['/learn', '/learn/study'],
  student_middle: ['/learn', '/learn/study'],
  student_senior: ['/learn', '/learn/study'],
  student_pending: ['/status'],
  teacher: ['/teacher', '/teacher/materials'],
  branch_admin: ['/school', '/school/content'],
  school_admin: ['/school', '/school/content'],
  platform_admin: ['/platform', '/platform/schools', '/platform/plans', '/platform/payments', '/platform/costs', '/platform/flags', '/platform/routing'],
};

for (const [persona, paths] of Object.entries(VISITS)) {
  test(`${persona} pages render without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript((p) => localStorage.setItem('ai-tutor-demo:v1', JSON.stringify({ persona: p, slices: {} })), persona);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByTestId('persona-switcher')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
      await expect(page.locator('main').first()).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });
}

test('persona switcher changes the app and root redirects home', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Viewing as/ }).click();
  await page.locator('[data-persona="teacher"]').click();
  await expect(page).toHaveURL(/\/teacher$/);
  await page.locator('[data-testid="persona-switcher"] button').last().click();
  await page.locator('[data-persona="platform_admin"]').click();
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/teacher'); // wrong persona is sent home
  await expect(page).toHaveURL(/\/platform$/);
});
