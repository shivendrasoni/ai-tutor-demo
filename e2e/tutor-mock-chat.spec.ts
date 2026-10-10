import { eq } from 'drizzle-orm';
import { expect, test } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import { resetDb, SEED_PASSWORD, seedTwoSchools } from '../tests/helpers/db';
import { activateStudent, seedStudyContent } from '../tests/helpers/study';

/*
 * No model keys exist in e2e (AI_MOCK=1), so the tutor runs on the mock language model through the real
 * app: /learn -> chat -> streamed reply built from the ingested passages -> citation chip.
 */
test.use({ viewport: { width: 390, height: 844 } });

let username: string;

test.beforeAll(async () => {
  await resetDb();
  const seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills();
  await seedStudyContent(seed.a);
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, seed.a.student.userId!)));
  username = u!.username!;
});

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

test('chat in /learn with no keys streams a mock reply with a citation chip', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/learn$/);

  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel('Explain').check();
  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page).toHaveURL(/\/learn\/c\/[0-9a-f-]{36}$/);

  await page.getByLabel('Your message').fill('Tell me about topic 1 in Chapter 1');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText(/According to your textbook/)).toBeVisible();
  await expect(page.getByText(/\[1\]/).first()).toBeVisible();
  const sources = page.getByRole('list', { name: 'Sources' });
  await expect(sources.getByText(/^\[1\] /)).toBeVisible();
});
