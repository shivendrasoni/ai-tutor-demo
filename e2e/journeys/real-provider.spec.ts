import { eq } from 'drizzle-orm';
import { expect, test } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import { resetDb, SEED_PASSWORD, seedTwoSchools } from '../../tests/helpers/db';
import { activateStudent } from '../../tests/helpers/study';
import { login } from '../helpers/seed';

/*
 * Real-provider journey (opt-in): E2E_REAL=1 with the OpenAI config in E2E_ENV_FILE. Nothing is mocked here:
 * a real NCERT chapter is uploaded, embedded with the real embedder, answered by the real chat model with
 * citations, turned into a study test by the real generator, and graded by the real grader.
 * Expect real-model variance; assertions check structure and state, never exact model wording.
 */
test.skip(process.env.E2E_REAL !== '1', 'real-provider journey: run with E2E_REAL=1');
test.use({ viewport: { width: 390, height: 844 } });

const NCERT_PDF = process.env.NCERT_PDF ?? '';
let schoolAdmin: { username: string; password: string };
let student: { username: string; password: string };
let subjectId: string;

const usernameOf = async (userId: string) => {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u!.username!;
};

test.beforeAll(async () => {
  await resetDb();
  const seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills();
  schoolAdmin = { username: await usernameOf(seed.a.schoolAdmin.userId!), password: SEED_PASSWORD };
  student = { username: await usernameOf(seed.a.student.userId!), password: SEED_PASSWORD };
  subjectId = seed.a.subjectId;
});

test('real NCERT chapter: upload, real tutor answer with sources, real study test generated and graded', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  expect(NCERT_PDF, 'set NCERT_PDF to the path of a free NCERT chapter PDF').not.toBe('');

  // 1. School admin uploads the chapter; it must reach Ready after real embedding.
  await login(page, schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  await page.goto('/school/content');
  await page.getByLabel('Title').fill('NCERT Science Class 8 Ch 1');
  await page.getByLabel('Kind').selectOption('book');
  await page.getByLabel('Scope').selectOption('school');
  await page.getByLabel('Grade').selectOption('8');
  await page.getByLabel('Subject').selectOption(subjectId);
  await page.getByLabel('PDF file').setInputFiles(NCERT_PDF);
  await page.getByRole('button', { name: 'Upload' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'NCERT Science Class 8 Ch 1' });
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 10 * 60_000 });

  // 2. Student asks the real tutor a question from the chapter; the answer streams and cites sources.
  await page.request.post('/api/auth/logout');
  await login(page, student);
  await expect(page).toHaveURL(/\/learn$/);
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel('Explain').check();
  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page).toHaveURL(/\/learn\/c\/[0-9a-f-]{36}$/);
  await page.getByLabel('Your message').fill('What do crops need to grow, according to this chapter?');
  await page.getByRole('button', { name: 'Send' }).click();
  // Send is disabled while the input is empty, so wait for the answer itself: grounded text plus its citations.
  await expect(page.getByText(/sunlight|water|nutrients/i).first()).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByRole('list', { name: 'Sources' })).toBeVisible({ timeout: 60_000 });

  // 3. Student generates a practice test from the chapter with the real generator (5 questions).
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Subject').selectOption(subjectId);
  const chapter1 = page.getByLabel('Chapter 1', { exact: true });
  await (await chapter1.count() ? chapter1 : page.getByRole('checkbox').first()).check({ timeout: 30_000 });
  await page.getByLabel(/Number of questions/).fill('5');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible({ timeout: 10 * 60_000 });

  // 4. Student takes the test; MCQs get a choice, short answers get a real sentence.
  await page.goto('/learn/study');
  await page.getByRole('link', { name: /NCERT|Practice test/ }).first().click();
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 5')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} of 5`)).toBeVisible();
    const group = page.getByRole('group', { name: 'Choose one' });
    if (await group.count()) {
      await group.first().getByRole('radio').first().check();
    } else {
      await page.getByLabel('Your answer').fill('Crops need sunlight, water and nutrients from the soil to grow.');
    }
    if (i < 4) await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();

  // 5. The real grader scores the short answers; the attempt reaches Graded with a score.
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByText(/\d+ \/ \d+/).first()).toBeVisible();
});
