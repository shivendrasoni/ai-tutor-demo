import { eq } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { artifacts, users } from '@/db/schema';
import { getPattern } from '@/modules/studytools/patterns';
import { seedSkills } from '@/modules/tutor/skills';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../tests/helpers/db';
import { activateStudent, insertArtifact, mcq, mockFor, seedStudyContent, short } from '../tests/helpers/study';

/*
 * No model keys exist in e2e, so nothing here depends on an LLM and there is no production test seam:
 * ready artifacts are inserted straight into the database (tests/helpers/study.ts insertArtifact).
 * Covered: hub, polling generating -> ready, the create form, taking a practice test (answer, autosave,
 * Previous/Next, submit, results), notes rendering, and a mock exam countdown.
 * Not covered here: LLM generation and short-answer grading (unit-tested in tests/studytools with fakes).
 * A short question is left blank at submit, which scores 0 without enqueuing a grade job.
 */

test.use({ viewport: { width: 390, height: 844 } });

let seed: Seed;
let ids: { subjectId: string; chapterIds: string[]; chunkIds: string[] };
let username: string;
let practiceTitle: string;

const sourcesFor = () =>
  Object.fromEntries(
    ids.chunkIds.slice(0, 2).map((id, i) => [id, { itemTitle: 'Test Book', chapterTitle: `Chapter ${i + 1}`, pageStart: 12 + i, pageEnd: 13 + i }]),
  );
const chapterTitles = () => Object.fromEntries(ids.chapterIds.map((id, i) => [id, `Chapter ${i + 1}`]));

test.beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills(STUDY_SKILLS);
  ids = await seedStudyContent(seed.a);
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, seed.a.student.userId!)));
  username = u.username!;
  const mine = (over: object) => insertArtifact(seed.a.schoolId, seed.a.student.userId!, ids.subjectId, over as never);
  const [c1, c2] = ids.chapterIds;
  const [k1, k2] = ids.chunkIds;

  practiceTitle = 'Algebra warm-up';
  await mine({
    params: { questionCount: 4, chapterTitles: chapterTitles() },
    content: {
      title: practiceTitle,
      questions: [
        mcq({ id: 'q1', prompt: 'First question?', correctIndex: 1, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q2', prompt: 'Second question?', correctIndex: 2, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q3', prompt: 'Third question?', correctIndex: 0, chapterId: c2, chunkIds: [k2] }),
        short({ id: 'q4', prompt: 'Explain it.', chapterId: c2, chunkIds: [k2] }),
      ],
      sources: sourcesFor(),
    },
  });

  await mine({
    type: 'last_night_notes',
    params: { chapterTitles: chapterTitles() },
    content: {
      title: 'Last-night revision',
      sections: [
        { heading: 'Key idea', bodyMarkdown: 'Remember the **rule** well.', chapterId: c1, passageRefs: ['P1'], chunkIds: [k1] },
      ],
      sources: sourcesFor(),
    },
  });

  const mock = mockFor((await getPattern('junior_50'))!);
  await mine({
    type: 'mock_exam',
    params: { patternKey: 'junior_50', chapterTitles: chapterTitles() },
    content: {
      ...mock,
      title: 'Grade 8 mock',
      sections: mock.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, chapterId: c1, chunkIds: [k1] })) })),
      sources: sourcesFor(),
    },
  });
});

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/learn$/);
}

test('study hub, practice test, notes and mock exam', async ({ page }) => {
  // One long journey through ~8 cold-compiled `next dev` routes; the 60 s default is too tight on a loaded machine.
  test.setTimeout(120_000);
  await login(page);
  await expect(page.getByRole('link', { name: 'Study' })).toBeVisible();
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/learn\/study$/);

  // Create form: a request is accepted and shows as Generating… (no worker or model runs in e2e).
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('Chapter 1').check();
  await page.getByLabel('Chapter 2').check();
  await page.getByLabel(/Number of questions/).fill('5');
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('Generating…').first()).toBeVisible();

  // Polling: flip that artifact to ready behind the UI's back; the badge updates within a few seconds.
  const [pending] = await withPlatform((tx) => tx.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.status, 'generating')));
  await withPlatform((tx) =>
    tx.update(artifacts).set({ status: 'ready', content: { title: 'Fresh test', questions: [], sources: {} } }).where(eq(artifacts.id, pending.id)),
  );
  await expect(page.getByText('Generating…')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Ready').first()).toBeVisible();

  // Practice test: open, start, answer, autosave, navigate, submit.
  await page.getByRole('link', { name: practiceTitle }).click();
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page).toHaveURL(/\/take$/);
  await expect(page.getByText('Question 1 of 4')).toBeVisible();
  await page.getByLabel('b', { exact: true }).check(); // q1 correct
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('a', { exact: true }).check(); // q2 wrong (correct is c)
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('a', { exact: true }).check(); // q3 correct
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const autosave = page.waitForResponse((r) => r.url().includes('/answers') && r.request().method() === 'PUT' && r.status() === 204);
  await page.getByLabel('Your answer').fill('temp text');
  await autosave; // 10 s autosave tick (also fires on navigation)
  await page.getByLabel('Your answer').fill(''); // blank short answers score 0 without a grading job
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Question 3 of 4')).toBeVisible();
  await expect(page.getByLabel('a', { exact: true })).toBeChecked();

  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page).toHaveURL(/\/learn\/study\/attempt\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('2 / 5')).toBeVisible();
  await expect(page.getByText('Chapter 1: 1 / 2')).toBeVisible();
  await expect(page.getByText('Chapter 2: 1 / 3')).toBeVisible();
  await expect(page.getByText('Correct answer: c')).toBeVisible();
  await expect(page.getByText('Model answer: Because.')).toBeVisible();

  // Notes: markdown rendered with a citation chip.
  await page.goto('/learn/study');
  await page.getByRole('tab', { name: 'Last-night notes' }).click();
  await page.getByRole('link', { name: 'Last-night revision' }).click();
  await expect(page.getByRole('heading', { name: 'Key idea' })).toBeVisible();
  await expect(page.locator('strong', { hasText: 'rule' })).toBeVisible();
  await expect(page.getByText('Test Book · Chapter 1 · p. 12–13')).toBeVisible();

  // Mock exam: countdown starts at the pattern's 2 hours (junior_50).
  await page.goto('/learn/study');
  await page.getByRole('tab', { name: 'Mock exams' }).click();
  await page.getByRole('link', { name: 'Grade 8 mock' }).click();
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByRole('timer')).toHaveText(/^(2:00:00|1:59:5\d)$/);
});
