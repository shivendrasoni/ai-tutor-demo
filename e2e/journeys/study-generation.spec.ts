import { eq } from 'drizzle-orm';
import { expect, test, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { artifacts, attempts, chunks, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { getStudyQueue } from '@/modules/studytools';
import { seedSkills } from '@/modules/tutor/skills';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';
import { activateStudent, insertArtifact, seedStudyContent } from '../../tests/helpers/study';

/*
 * Study GENERATION and GRADING through the UI, with the in-process study workers running (global-setup starts them
 * with AI_MOCK=1, so the generator and grader are the deterministic mock models in src/modules/tutor/models/mock.ts).
 *
 * Mock facts relied on (keep in sync with that file):
 * - A practice test of N questions has ceil(0.6N) MCQs (1 mark, 4 options) followed by short answers (2 marks).
 * - The MCQ option that is not one of the three fixed DISTRACTORS is the correct one.
 * - The grader scores each short answer round(marks)/2 and always returns the same feedback sentence.
 *
 * Every test resets and reseeds the database. Nothing here uses a payment route; the student is activated directly.
 * The existing suites cover seeded (non-generated) artifacts and API-only edge cases (student-study.spec.ts,
 * e2e/study.spec.ts); this file drives the create-generate-take-grade loop itself.
 */

test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ timeout: 180_000 });

const GEN_TIMEOUT = 60_000; // generate job: pg-boss poll (about 2 s) + mock model + writes
const GRADE_TIMEOUT = 60_000; // grade job: same worker path as generation
const MOCK_TITLE = 'Practice test (mock)';
const DISTRACTORS = [
  'It is not covered in the passage.',
  'The opposite is stated in the passage.',
  'None of these.',
];

type Ctx = { seed: Seed; username: string; studentId: string; subjectId: string; chapterIds: string[] };

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function setup(): Promise<Ctx> {
  await resetDb();
  const seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills(STUDY_SKILLS);
  const ids = await seedStudyContent(seed.a, { chapters: 3 });
  const studentId = seed.a.student.userId!;
  return { seed, username: await usernameOf(studentId), studentId, subjectId: ids.subjectId, chapterIds: ids.chapterIds };
}

// ---------- database reads (state checks only; every action goes through the UI or the API) ----------

const artifactRowsOf = (studentId: string, type: 'practice_test' | 'mock_exam' | 'study_notes' | 'last_night_notes') =>
  withPlatform((tx) => tx.select().from(artifacts).where(eq(artifacts.studentId, studentId)).then((rows) => rows.filter((r) => r.type === type)));

const attemptRowsOf = (artifactId: string) =>
  withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.artifactId, artifactId)));

// ---------- UI helpers ----------

async function uiLogin(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/learn$/);
}

async function openCreateForm(page: Page): Promise<void> {
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
}

/** Fills the create form for a practice test and presses Generate. Does not wait for the result. */
async function requestPracticeTest(page: Page, chapters: string[], count: number): Promise<void> {
  await openCreateForm(page);
  for (const title of chapters) await page.getByLabel(title, { exact: true }).check();
  await page.getByLabel(/Number of questions/).fill(String(count));
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
}

/** Requests a practice test through the UI and waits for the worker to finish it (the list shows Ready). */
async function generatePracticeTest(page: Page, chapters: string[], count: number): Promise<void> {
  await requestPracticeTest(page, chapters, count);
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: GEN_TIMEOUT });
}

/** From the Study hub's practice-test list: opens the ready test and starts an attempt. */
async function openAndStartTest(page: Page, count: number): Promise<void> {
  await page.goto('/learn/study');
  await page.getByRole('link', { name: MOCK_TITLE }).click();
  await startTest(page, count);
}

async function startTest(page: Page, count: number): Promise<void> {
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page).toHaveURL(/\/take$/);
  await expect(page.getByText(`Question 1 of ${count}`)).toBeVisible();
}

/**
 * Answers every question in order. MCQs get the correct option (`correct`) or a known distractor (`wrong`); short answers
 * get `shortText`. The mock's correct option is the one that is not one of its fixed distractors.
 */
async function answerTest(page: Page, count: number, mode: 'correct' | 'wrong', shortText: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    await expect(page.getByText(`Question ${i + 1} of ${count}`)).toBeVisible();
    const group = page.getByRole('group', { name: 'Choose one' });
    if (await group.count()) {
      const labels = (await group.locator('label').allInnerTexts()).map((t) => t.trim());
      const wantDistractor = mode === 'wrong';
      const pick = labels.find((t) => DISTRACTORS.includes(t) === wantDistractor);
      expect(pick, `an option to ${mode === 'wrong' ? 'pick wrongly' : 'pick correctly'} on question ${i + 1}`).toBeDefined();
      await group.getByLabel(pick!, { exact: true }).check();
    } else {
      await page.getByLabel('Your answer').fill(shortText);
    }
    if (i < count - 1) await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
}

async function submitTest(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page).toHaveURL(/\/learn\/study\/attempt\/[0-9a-f-]{36}$/);
  return page.url().match(/attempt\/([0-9a-f-]{36})/)![1]!;
}

// ---------- 1. generation ----------

test('student requests a practice test from the hub: it shows Generating…, then Ready, with its questions', async ({ page }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await requestPracticeTest(page, ['Chapter 1', 'Chapter 2'], 5);

  // The job is enqueued in the same request, so the list shows Generating… until the worker finishes.
  await expect(page.getByText('Generating…').first()).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: GEN_TIMEOUT });
  await expect(page.getByText('Generating…')).toHaveCount(0);

  const [row] = await artifactRowsOf(c.studentId, 'practice_test');
  expect(row.status).toBe('ready');
  expect(row.error).toBeNull();
  expect((row.content as { questions: unknown[] }).questions).toHaveLength(5);

  await page.getByRole('link', { name: MOCK_TITLE }).click();
  await expect(page.getByText('5 questions', { exact: true })).toBeVisible();
  await startTest(page, 5);
  await expect(page.getByText('Which statement matches your textbook (question 1)?')).toBeVisible();
});

// ---------- 2. take, grade, score ----------

test('practice test: answer MCQs and short answers, submit, and the worker grades the short answers to a final score', async ({ page }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await generatePracticeTest(page, ['Chapter 1', 'Chapter 2'], 5);
  await openAndStartTest(page, 5);
  await answerTest(page, 5, 'correct', 'Plants make food from sunlight.');
  const attemptId = await submitTest(page);

  // Grading: the attempt page shows Grading… while the grade jobs run, then Graded with the final total.
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible({ timeout: GRADE_TIMEOUT });
  // 3 MCQs (1 mark each, all correct) + 2 short answers (2 marks each, mock grade = 1 each) = 5 of 7.
  await expect(page.getByText('5 / 7', { exact: true })).toBeVisible();
  // Chapter split: questions alternate chapters; ch1 = Q1, Q3 (MCQ), Q5 (short); ch2 = Q2 (MCQ), Q4 (short).
  await expect(page.getByText('Chapter 1: 3 / 4')).toBeVisible();
  await expect(page.getByText('Chapter 2: 2 / 3')).toBeVisible();
  // The grader's feedback is only present for graded short answers, so it proves the worker ran.
  await expect(page.getByText('Good effort, you earned about half the marks.')).toHaveCount(2);
  await expect(page.getByText('Score: 1 / 2')).toHaveCount(2);

  const [att] = await attemptRowsOf((await artifactRowsOf(c.studentId, 'practice_test'))[0]!.id);
  expect(att.id).toBe(attemptId);
  expect(att.status).toBe('graded');
  expect(Number(att.score)).toBe(5);
  expect(Number(att.maxScore)).toBe(7);
  const results = att.results as Record<string, { feedback?: string; needsReview?: boolean }>;
  const shortIds = Object.keys(results).filter((k) => results[k]!.feedback);
  expect(shortIds).toHaveLength(2);
  expect(shortIds.some((k) => results[k]!.needsReview)).toBe(false);
});

// ---------- 3. failure paths ----------

test('daily limit: with 10 requests already today, the form shows the limit message and creates nothing', async ({ page }) => {
  const c = await setup();
  for (let i = 0; i < 10; i++) {
    await insertArtifact(c.seed.a.schoolId, c.studentId, c.subjectId, {
      type: 'practice_test',
      status: 'ready',
      chapterIds: [c.chapterIds[0]!],
      params: { questionCount: 5, chapterTitles: {} },
      content: { title: `Earlier set ${i + 1}`, questions: [] },
    });
  }
  await uiLogin(page, c.username);
  await requestPracticeTest(page, ['Chapter 1'], 10);

  await expect(page.getByText("You have reached today's limit of 10. Try again tomorrow.")).toBeVisible();
  // The form stays open so the student sees the message; no eleventh row is created.
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  expect(await artifactRowsOf(c.studentId, 'practice_test')).toHaveLength(10);
});

test('invalid question count: the form blocks 3 and 31 without a request, and the API refuses both', async ({ page }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/study/artifacts')) posts.push(r.url());
  });

  await openCreateForm(page);
  await page.getByLabel('Chapter 1', { exact: true }).check();
  const count = page.getByLabel(/Number of questions/);
  for (const bad of ['3', '31']) {
    await count.fill(bad);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    // The browser's own constraint check (min=5, max=30) stops the submit; no custom message is shown.
    expect(await count.evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  }
  expect(posts).toHaveLength(0);

  for (const bad of [3, 31]) {
    const r = await page.request.post('/api/study/artifacts', {
      data: { type: 'practice_test', subjectId: c.subjectId, chapterIds: [c.chapterIds[0]], questionCount: bad },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error.code).toBe('VALIDATION');
  }
  expect(await artifactRowsOf(c.studentId, 'practice_test')).toHaveLength(0);
});

test('a chapter from another school is refused by the API for this subject, and no artifact is created', async ({ page }) => {
  const c = await setup();
  const other = await seedStudyContent(c.seed.b, { chapters: 1 });
  await uiLogin(page, c.username);

  // The hub only lists chapters the student can see, so the UI cannot select this chapter. The API is checked with the
  // same session the page uses.
  const r = await page.request.post('/api/study/artifacts', {
    data: { type: 'practice_test', subjectId: c.subjectId, chapterIds: [other.chapterIds[0]], questionCount: 5 },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).error.message).toBe('A chapter is not available for this subject');
  expect(await artifactRowsOf(c.studentId, 'practice_test')).toHaveLength(0);
});

test('a generate job that fails (chapter with no passages) ends in the Failed state, shown on the hub and the artifact page', async ({ page }) => {
  const c = await setup();
  // A chapter with no passages cannot be picked in the UI (the hub lists only chapters with content), so the failing
  // request is written directly as a generating artifact and handed to the same enqueue seam the app uses. The worker then
  // finds no passages and marks the artifact failed, as it does for any chapter whose content disappears before generation.
  const empty = c.chapterIds[2]!;
  await withPlatform((tx) => tx.delete(chunks).where(eq(chunks.chapterId, empty)));
  const art = await insertArtifact(c.seed.a.schoolId, c.studentId, c.subjectId, {
    type: 'practice_test',
    status: 'generating',
    content: null,
    chapterIds: [empty],
    params: { questionCount: 5, chapterTitles: { [empty]: 'Chapter 3' } },
  });
  await getStudyQueue().enqueueGenerate({ artifactId: art.id, schoolId: c.seed.a.schoolId });

  await uiLogin(page, c.username);
  await page.goto('/learn/study');
  await expect(page.getByText('Failed — try again', { exact: true })).toBeVisible({ timeout: GEN_TIMEOUT });

  await page.goto(`/learn/study/a/${art.id}`);
  await expect(page.getByText('Failed — try again from the Study page.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start test' })).toHaveCount(0);

  const [row] = await artifactRowsOf(c.studentId, 'practice_test');
  expect(row.status).toBe('failed');
  expect(row.error).toBe('GENERATION_FAILED');
  expect(row.content).toBeNull();
});

// ---------- 4. retake ----------

test('retake: a second attempt is created, and the first attempt keeps its graded score', async ({ page }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await generatePracticeTest(page, ['Chapter 1', 'Chapter 2'], 5);
  await openAndStartTest(page, 5);
  await answerTest(page, 5, 'correct', 'First attempt answer.');
  const firstAttempt = await submitTest(page);
  await expect(page.getByText('5 / 7', { exact: true })).toBeVisible({ timeout: GRADE_TIMEOUT });
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible();

  // Back to the test and retake it.
  await page.getByRole('link', { name: /Practice test \(mock\)/ }).click();
  await startTest(page, 5);
  await answerTest(page, 5, 'wrong', 'Second attempt answer.');
  const secondAttempt = await submitTest(page);
  expect(secondAttempt).not.toBe(firstAttempt);
  // MCQs all wrong (0 of 3), short answers still 1 each: 2 of 7.
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible({ timeout: GRADE_TIMEOUT });
  await expect(page.getByText('2 / 7', { exact: true })).toBeVisible();

  const [art] = await artifactRowsOf(c.studentId, 'practice_test');
  const rows = await attemptRowsOf(art!.id);
  expect(rows).toHaveLength(2);
  const first = rows.find((r) => r.id === firstAttempt)!;
  const second = rows.find((r) => r.id === secondAttempt)!;
  expect(first.status).toBe('graded');
  expect(Number(first.score)).toBe(5);
  expect(Number(second.score)).toBe(2);

  // The artifact page lists both attempts, and the first keeps its score.
  await page.goto(`/learn/study/a/${art!.id}`);
  await expect(page.locator(`a[href="/learn/study/attempt/${firstAttempt}"]`)).toContainText('5 / 7');
  await expect(page.locator(`a[href="/learn/study/attempt/${secondAttempt}"]`)).toContainText('2 / 7');
  await page.goto(`/learn/study/attempt/${firstAttempt}`);
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible();
  await expect(page.getByText('5 / 7', { exact: true })).toBeVisible();

  // The hub reports the best score and the attempt count.
  await page.goto('/learn/study');
  await expect(page.getByText('Best 71% · 2 attempts')).toBeVisible();
});

// ---------- 5. access ----------

test('another student cannot open the artifact or the attempt, and sees no content', async ({ page, browser }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await generatePracticeTest(page, ['Chapter 1'], 5);
  const [art] = await artifactRowsOf(c.studentId, 'practice_test');
  // The owner starts an attempt and saves an answer, so there is something to protect.
  const started = await page.request.post(`/api/study/artifacts/${art!.id}/attempts`);
  expect(started.status()).toBe(201);
  const { attemptId } = (await started.json()) as { attemptId: string };
  const saved = await page.request.put(`/api/study/attempts/${attemptId}/answers`, { data: { answers: { q1: 1 } } });
  expect(saved.status()).toBe(204);

  // A second student in the same school.
  const peer = await signupWithCode({
    code: c.seed.a.code,
    grade: 8,
    studentName: 'Peer Kid',
    parentName: 'Peer Parent',
    parentPhone: '9000000002',
    planId: c.seed.planId,
    username: 'peer.kid',
    password: SEED_PASSWORD,
  });
  await activateStudent({
    userId: peer.studentUserId,
    isPlatformAdmin: false,
    schoolId: c.seed.a.schoolId,
    branchId: c.seed.a.branchId,
    roles: ['student'],
  });

  const peerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const peerPage = await peerCtx.newPage();
    await uiLogin(peerPage, 'peer.kid');

    await peerPage.goto(`/learn/study/a/${art!.id}`);
    await expect(peerPage.getByText('Not found.')).toBeVisible();
    await expect(peerPage.getByText(MOCK_TITLE)).toHaveCount(0);
    await expect(peerPage.getByText('Which statement matches your textbook')).toHaveCount(0);

    await peerPage.goto(`/learn/study/attempt/${attemptId}`);
    await expect(peerPage.getByText('Could not load this attempt.')).toBeVisible();

    const api = await peerPage.request.get(`/api/study/artifacts/${art!.id}`);
    expect(api.status()).toBe(404);
    expect((await api.json()).error.code).toBe('NOT_FOUND');
    const attemptApi = await peerPage.request.get(`/api/study/attempts/${attemptId}`);
    expect(attemptApi.status()).toBe(404);
    expect((await attemptApi.text()).includes('Which statement')).toBe(false);
    const put = await peerPage.request.put(`/api/study/attempts/${attemptId}/answers`, { data: { answers: { q1: 0 } } });
    expect(put.status()).toBe(404);
    const submit = await peerPage.request.post(`/api/study/attempts/${attemptId}/submit`);
    expect(submit.status()).toBe(404);

    await peerPage.goto('/learn/study');
    await expect(peerPage.getByText('Nothing here yet. Create one above.')).toBeVisible();
  } finally {
    await peerCtx.close();
  }

  // The owner's attempt was not touched by the peer's requests.
  const [still] = await attemptRowsOf(art!.id);
  expect(still!.answers).toEqual({ q1: 1 });
  expect(still!.status).toBe('in_progress');
});
