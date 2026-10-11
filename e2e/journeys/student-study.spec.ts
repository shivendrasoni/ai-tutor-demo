import { and, eq } from 'drizzle-orm';
import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { artifacts, attempts, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { getPattern } from '@/modules/studytools/patterns';
import type { Actor } from '@/modules/tenancy/actor';
import { seedSkills } from '@/modules/tutor/skills';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';
import { activateStudent, insertArtifact, mcq, mockFor, seedStudyContent, short } from '../../tests/helpers/study';

/*
 * Student study journeys (sub-project 4). No LLM or worker runs in e2e (global-setup starts only the ingest
 * worker), so artifacts are inserted with insertArtifact and generate/grade jobs stay queued. Every test resets
 * and reseeds the database, so tests are independent.
 */

test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ timeout: 120_000 });

type Ctx = { seed: Seed; username: string; subjectId: string; chapters: string[]; chunks: string[] };

const APP_URL = process.env.APP_URL!;

// ---------- setup and fixtures ----------

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function setup(chapters = 3): Promise<Ctx> {
  await resetDb();
  const seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills(STUDY_SKILLS);
  const ids = await seedStudyContent(seed.a, { chapters });
  return {
    seed,
    username: await usernameOf(seed.a.student.userId!),
    subjectId: ids.subjectId,
    chapters: ids.chapterIds,
    chunks: ids.chunkIds,
  };
}

const titles = (c: Ctx) => Object.fromEntries(c.chapters.map((id, i) => [id, `Chapter ${i + 1}`]));
const sources = (c: Ctx) =>
  Object.fromEntries(
    c.chunks.slice(0, 2).map((id, i) => [id, { itemTitle: 'Test Book', chapterTitle: `Chapter ${i + 1}`, pageStart: 12 + i, pageEnd: 13 + i }]),
  );

const insertFor = (c: Ctx, over: Record<string, unknown>) =>
  insertArtifact(c.seed.a.schoolId, c.seed.a.student.userId!, c.subjectId, over as never);

/** Practice test: q1 mcq (correct b), q2 mcq (correct c), q3 mcq (correct a), q4 short (2 marks). Max score 5. */
async function addQuiz(c: Ctx, title = 'Algebra warm-up') {
  const [c1, c2] = c.chapters;
  const [k1, k2] = c.chunks;
  return insertFor(c, {
    params: { questionCount: 4, chapterTitles: titles(c) },
    content: {
      title,
      questions: [
        mcq({ id: 'q1', prompt: 'First question?', correctIndex: 1, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q2', prompt: 'Second question?', correctIndex: 2, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q3', prompt: 'Third question?', correctIndex: 0, chapterId: c2, chunkIds: [k2] }),
        short({ id: 'q4', prompt: 'Explain it.', chapterId: c2, chunkIds: [k2] }),
      ],
      sources: sources(c),
    },
  });
}

/** Practice test with four MCQs only (correct indexes 1, 2, 0, 3). Max score 4. */
async function addMcqQuiz(c: Ctx, title = 'MCQ drill') {
  const [c1, c2] = c.chapters;
  const [k1, k2] = c.chunks;
  return insertFor(c, {
    params: { questionCount: 4, chapterTitles: titles(c) },
    content: {
      title,
      questions: [
        mcq({ id: 'q1', prompt: 'First question?', correctIndex: 1, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q2', prompt: 'Second question?', correctIndex: 2, chapterId: c1, chunkIds: [k1] }),
        mcq({ id: 'q3', prompt: 'Third question?', correctIndex: 0, chapterId: c2, chunkIds: [k2] }),
        mcq({ id: 'q4', prompt: 'Fourth question?', correctIndex: 3, chapterId: c2, chunkIds: [k2] }),
      ],
      sources: sources(c),
    },
  });
}

/** A practice test with the given questions (for layout checks). */
async function addCustomQuiz(c: Ctx, questions: unknown[]) {
  return insertFor(c, {
    params: { questionCount: questions.length, chapterTitles: titles(c) },
    content: { title: 'Long text quiz', questions, sources: {} },
  });
}

/** Mock exam from the junior_50 pattern (120 minutes), remapped onto the seeded chapter. */
async function addMock(c: Ctx) {
  const pattern = (await getPattern('junior_50'))!;
  const mock = mockFor(pattern);
  const [c1] = c.chapters;
  const [k1] = c.chunks;
  return insertFor(c, {
    type: 'mock_exam',
    params: { patternKey: 'junior_50', chapterTitles: titles(c) },
    content: {
      ...mock,
      title: 'Grade 8 mock',
      sections: mock.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, chapterId: c1, chunkIds: [k1] })) })),
      sources: sources(c),
    },
  });
}

/** Artifact rows with no content (failed or still generating). */
const addRaw = (c: Ctx, over: Record<string, unknown>) => insertFor(c, { params: { chapterTitles: titles(c) }, content: null, ...over });

const attemptRows = (artifactId: string) =>
  withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.artifactId, artifactId)));

const artifactRowsOf = (studentId: string, type: string) =>
  withPlatform((tx) =>
    tx.select().from(artifacts).where(and(eq(artifacts.studentId, studentId), eq(artifacts.type, type as never))),
  );

// ---------- login and API helpers ----------

async function uiLogin(page: Page, username: string, landing: RegExp = /\/learn$/): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(landing);
}

async function apiLogin(api: APIRequestContext, username: string): Promise<void> {
  const r = await api.post('/api/auth/login', { data: { username, password: SEED_PASSWORD } });
  expect(r.status(), 'API login').toBe(200);
}

async function startApi(api: APIRequestContext, artifactId: string) {
  const r = await api.post(`/api/study/artifacts/${artifactId}/attempts`);
  expect(r.status(), 'start attempt').toBe(201);
  return (await r.json()) as { attemptId: string; deadline: string | null; answers: Record<string, number | string> };
}

async function saveApi(api: APIRequestContext, attemptId: string, answers: Record<string, number | string>): Promise<void> {
  const r = await api.put(`/api/study/attempts/${attemptId}/answers`, { data: { answers } });
  expect(r.status(), 'save answers').toBe(204);
}

async function submitApi(api: APIRequestContext, attemptId: string): Promise<{ status: string }> {
  const r = await api.post(`/api/study/attempts/${attemptId}/submit`);
  expect(r.status(), 'submit').toBe(200);
  return r.json();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, 'page is wider than the 390px viewport').toBeLessThanOrEqual(cw);
}

const attemptLinks = (page: Page) => page.locator('a[href^="/learn/study/attempt/"]');

// ---------- hub and create form ----------

test('hub lists tests with their state, and empty tabs say nothing is there', async ({ page }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await addRaw(c, { type: 'practice_test', status: 'failed', error: 'GENERATION_FAILED' });
  await addRaw(c, { type: 'practice_test', status: 'generating' });
  await uiLogin(page, c.username);
  await page.goto('/learn/study');

  const panel = page.getByRole('tabpanel');
  await expect(page.getByRole('link', { name: 'Algebra warm-up' })).toHaveAttribute('href', `/learn/study/a/${quiz.id}`);
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('Failed — try again')).toBeVisible();
  await expect(page.getByText('Generating…')).toBeVisible();
  await expect(page.getByText(/^Best /)).toHaveCount(0); // no graded attempt yet
  await expectNoHorizontalScroll(page);

  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(page.getByText('Nothing here yet. Create one above.')).toBeVisible();
  await page.getByRole('tab', { name: 'Mock exams' }).click();
  await expect(page.getByText('Nothing here yet. Create one above.')).toBeVisible();
});

test('create form: Generate needs a subject and a chapter, and at most 6 chapters can be picked', async ({ page }) => {
  const c = await setup(7);
  await uiLogin(page, c.username);
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  await expect(generate).toBeDisabled();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await expect(page.getByText('Chapters (up to 6)')).toBeVisible();
  await expect(generate).toBeDisabled(); // subject chosen, no chapter yet

  for (let i = 1; i <= 6; i++) await page.getByLabel(`Chapter ${i}`, { exact: true }).check();
  await expect(page.getByLabel('Chapter 7', { exact: true })).toBeDisabled();
  await expect(generate).toBeEnabled();

  await page.getByLabel('Chapter 1', { exact: true }).uncheck();
  await expect(page.getByLabel('Chapter 7', { exact: true })).toBeEnabled();
});

test('create a practice test: the request is accepted, stored as generating, and shows Generating…', async ({ page }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('Chapter 1', { exact: true }).check();
  await page.getByLabel(/Number of questions/).fill('5');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(page.getByText('Generating…').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible(); // form closes after the request
  const [row] = await artifactRowsOf(c.seed.a.student.userId!, 'practice_test');
  expect(row.status).toBe('generating');
  expect(row.subjectId).toBe(c.subjectId);
  expect(row.chapterIds).toEqual([c.chapters[0]]);
  expect(row.params).toMatchObject({ questionCount: 5 });
});

test('question count outside 5 to 30 is refused by the form and by the API', async ({ page, request }) => {
  const c = await setup();
  await uiLogin(page, c.username);
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('Chapter 1', { exact: true }).check();
  await page.getByLabel(/Number of questions/).fill('3');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // The number input has min=5, so the browser blocks the submit: the form stays open and nothing is created.
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  expect(await artifactRowsOf(c.seed.a.student.userId!, 'practice_test')).toHaveLength(0);

  await apiLogin(request, c.username);
  const base = { type: 'practice_test', subjectId: c.subjectId, chapterIds: [c.chapters[0]] };
  for (const bad of [3, 31]) {
    const r = await request.post('/api/study/artifacts', { data: { ...base, questionCount: bad } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error.code).toBe('VALIDATION');
  }
  // The route's schema rejects the count first, so the message is the generic one (the service message is not reached).
  const r = await request.post('/api/study/artifacts', { data: { ...base, questionCount: 3 } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error.code).toBe('VALIDATION');
  const notesWithCount = await request.post('/api/study/artifacts', { data: { ...base, type: 'study_notes', questionCount: 5 } });
  expect((await notesWithCount.json()).error.message).toBe('questionCount is only for practice tests');
  const emptyChapters = await request.post('/api/study/artifacts', { data: { ...base, chapterIds: [] } });
  expect(emptyChapters.status()).toBe(400);
  expect(await artifactRowsOf(c.seed.a.student.userId!, 'practice_test')).toHaveLength(0);
});

test('daily generation limit: the request after 10 today is refused with the limit message', async ({ page, request }) => {
  const c = await setup();
  for (let i = 0; i < 10; i++) await addRaw(c, { type: 'practice_test', status: 'ready', content: { title: `Set ${i}`, questions: [], sources: {} } });
  await uiLogin(page, c.username);
  await page.goto('/learn/study');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('Chapter 1', { exact: true }).check();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(page.getByText("You have reached today's limit of 10. Try again tomorrow.")).toBeVisible();
  expect(await artifactRowsOf(c.seed.a.student.userId!, 'practice_test')).toHaveLength(10);

  await apiLogin(request, c.username);
  const r = await request.post('/api/study/artifacts', {
    data: { type: 'practice_test', subjectId: c.subjectId, chapterIds: [c.chapters[0]], questionCount: 5 },
  });
  expect(r.status()).toBe(429);
  expect((await r.json()).error.code).toBe('GENERATION_LIMIT');
});

test('a chapter from another school, or one that does not exist, is refused for this subject', async ({ request }) => {
  const c = await setup();
  const other = await seedStudyContent(c.seed.b, { chapters: 1 });
  await apiLogin(request, c.username);
  const body = (chapterIds: string[]) => ({ type: 'practice_test', subjectId: c.subjectId, chapterIds, questionCount: 5 });
  for (const chapterIds of [other.chapterIds, ['00000000-0000-4000-8000-00000000dead']]) {
    const r = await request.post('/api/study/artifacts', { data: body(chapterIds) });
    expect(r.status()).toBe(400);
    expect((await r.json()).error.message).toBe('A chapter is not available for this subject');
  }
  expect(await artifactRowsOf(c.seed.a.student.userId!, 'practice_test')).toHaveLength(0);
});

// ---------- taking a test ----------

test('practice test: answer, move between questions, submit and read the graded review', async ({ page }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page).toHaveURL(/\/take$/);
  await expect(page.getByText('Question 1 of 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();

  await page.getByLabel('b', { exact: true }).check(); // q1: correct
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('a', { exact: true }).check(); // q2: wrong (correct is c)
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('a', { exact: true }).check(); // q3: correct
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Question 4 of 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Question 3 of 4')).toBeVisible();
  await expect(page.getByLabel('a', { exact: true })).toBeChecked();

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page).toHaveURL(/\/learn\/study\/attempt\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible();
  await expect(page.getByText('2 / 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Chapter 1: 1 / 2')).toBeVisible();
  await expect(page.getByText('Chapter 2: 1 / 3')).toBeVisible();
  await expect(page.getByText('Your answer: b')).toBeVisible();
  await expect(page.getByText('Your answer: No answer')).toBeVisible(); // q4 left blank
  await expect(page.getByText('Correct answer: c')).toBeVisible();
  await expect(page.getByText('Model answer: Because.')).toBeVisible();

  await page.goto('/learn/study');
  await expect(page.getByText('Best 40% · 1 attempt')).toBeVisible();
});

test('answers survive a reload: Next saves at once, and autosave saves within 10 seconds', async ({ page }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page).toHaveURL(/\/take$/);
  await expect(page.getByText('Question 1 of 4')).toBeVisible();

  await page.getByLabel('b', { exact: true }).check();
  const savedOnNext = page.waitForResponse((r) => r.url().includes('/answers') && r.request().method() === 'PUT' && r.status() === 204);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await savedOnNext;
  await page.reload();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();
  await expect(page.getByLabel('b', { exact: true })).toBeChecked();

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const autosaved = page.waitForResponse((r) => r.url().includes('/answers') && r.request().method() === 'PUT' && r.status() === 204, { timeout: 25_000 });
  await page.getByLabel('c', { exact: true }).check();
  await autosaved; // no navigation: the 10 s autosave tick
  await page.reload();
  await page.getByRole('button', { name: 'Question 2', exact: true }).click();
  await expect(page.getByLabel('c', { exact: true })).toBeChecked();

  const [att] = await attemptRows(quiz.id);
  expect(att.status).toBe('in_progress');
  expect(att.answers).toEqual({ q1: 1, q2: 2 });
});

test('submit asks first; Keep working leaves the attempt open; unanswered questions score 0', async ({ page }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('You cannot change them afterwards.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep working' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const [open] = await attemptRows(quiz.id);
  expect(open.status).toBe('in_progress');
  expect(open.submittedAt).toBeNull();

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page).toHaveURL(/\/learn\/study\/attempt\//);
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible();
  await expect(page.getByText('0 / 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Your answer: No answer')).toHaveCount(4);
});

test('answered short answers wait for grading, and the attempt shows Grading…', async ({ page }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Your answer').fill('Because of the rule.');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();

  await expect(page).toHaveURL(/\/learn\/study\/attempt\//);
  await expect(page.getByText('Grading…')).toBeVisible();
  const [att] = await attemptRows(quiz.id);
  expect(att.status).toBe('grading');
});

test('an attempt cannot be answered after it is submitted; a second submit changes nothing', async ({ request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await apiLogin(request, c.username);
  const st = await startApi(request, quiz.id);
  await saveApi(request, st.attemptId, { q1: 1 });
  expect((await submitApi(request, st.attemptId)).status).toBe('graded');

  const late = await request.put(`/api/study/attempts/${st.attemptId}/answers`, { data: { answers: { q2: 0 } } });
  expect(late.status()).toBe(400);
  expect((await late.json()).error).toMatchObject({ code: 'VALIDATION', message: 'This attempt is already submitted' });

  expect((await submitApi(request, st.attemptId)).status).toBe('graded');
  const view = await (await request.get(`/api/study/attempts/${st.attemptId}`)).json();
  expect(view.answers).toEqual({ q1: 1 });
  expect(view.score).toBe(1);
  expect(view.maxScore).toBe(5);
});

test('answer validation is all-or-nothing and rejects unknown questions and bad values', async ({ request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await apiLogin(request, c.username);
  const st = await startApi(request, quiz.id);
  const put = (answers: unknown) => request.put(`/api/study/attempts/${st.attemptId}/answers`, { data: { answers } });

  const badIndex = await put({ q1: 1, q2: 9 });
  expect(badIndex.status()).toBe(400);
  expect((await badIndex.json()).error.message).toBe('Invalid answer');
  const unknown = await put({ nope: 1 });
  expect((await unknown.json()).error.message).toBe('Unknown question');
  const numberForShort = await put({ q4: 5 });
  expect((await numberForShort.json()).error.message).toBe('Invalid answer');
  const textForMcq = await put({ q1: 'b' });
  expect((await textForMcq.json()).error.message).toBe('Invalid answer');

  const view = await (await request.get(`/api/study/attempts/${st.attemptId}`)).json();
  expect(view.answers).toEqual({}); // none of the bad batches was partly saved

  await saveApi(request, st.attemptId, { q1: 1, q4: 'a short answer' });
  const after = await (await request.get(`/api/study/attempts/${st.attemptId}`)).json();
  expect(after.answers).toEqual({ q1: 1, q4: 'a short answer' });
});

test('starting again resumes the open attempt; the attempt page links back to it', async ({ page, request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await apiLogin(request, c.username);
  const first = await startApi(request, quiz.id);
  await saveApi(request, first.attemptId, { q1: 1 });
  const again = await startApi(request, quiz.id);
  expect(again.attemptId).toBe(first.attemptId);
  expect(again.answers).toEqual({ q1: 1 });

  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: /in progress/ }).click();
  await expect(page.getByText('This attempt is still in progress.')).toBeVisible();
  await page.getByRole('link', { name: 'Resume attempt' }).click();
  await expect(page).toHaveURL(/\/take$/);
  await expect(page.getByText('Question 1 of 4')).toBeVisible();
  await expect(page.getByLabel('b', { exact: true })).toBeChecked(); // saved answer restored
});

test('retake: a graded test lists its attempts, and Start test begins a new one', async ({ page, request }) => {
  const c = await setup();
  const quiz = await addQuiz(c, 'Algebra warm-up');
  const other = await addQuiz(c, 'Fractions drill');
  await apiLogin(request, c.username);
  const st = await startApi(request, quiz.id);
  await saveApi(request, st.attemptId, { q1: 1, q3: 0 });
  await submitApi(request, st.attemptId);

  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${other.id}`);
  await expect(page.getByRole('heading', { name: 'Your attempts' })).toHaveCount(0); // empty state: no attempts
  await expect(page.getByRole('link', { name: 'Start test' })).toBeVisible();

  await page.goto(`/learn/study/a/${quiz.id}`);
  await expect(page.getByRole('heading', { name: 'Your attempts' })).toBeVisible();
  await expect(attemptLinks(page)).toHaveCount(1);
  await expect(page.getByRole('link', { name: /· 2 \/ 5$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();

  const rows = await attemptRows(quiz.id);
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.status).sort()).toEqual(['graded', 'in_progress']);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await expect(attemptLinks(page)).toHaveCount(2);
});

test('mock exam: the countdown starts at 2 hours, and an attempt past its deadline is closed at the deadline', async ({ page, request }) => {
  const c = await setup();
  const mock = await addMock(c);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${mock.id}`);
  await expect(page.getByText(/· 120 minutes/)).toBeVisible();
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByRole('timer')).toHaveText(/^(2:00:00|1:59:5\d)$/);

  const [att] = await attemptRows(mock.id);
  expect(att.status).toBe('in_progress');
  // The student was away for 2 h 30 min: past the 120 min deadline plus the 2 min grace.
  await withPlatform((tx) => tx.update(attempts).set({ startedAt: new Date(Date.now() - 150 * 60_000) }).where(eq(attempts.id, att.id)));

  await apiLogin(request, c.username);
  const late = await request.put(`/api/study/attempts/${att.id}/answers`, { data: { answers: {} } });
  expect(late.status()).toBe(409);
  expect((await late.json()).error.code).toBe('ATTEMPT_EXPIRED');

  const view = await (await request.get(`/api/study/attempts/${att.id}`)).json();
  expect(view.status).toBe('graded');
  expect(view.submittedAt).toBe(view.deadline);
  expect(view.score).toBe(0);
  await page.goto(`/learn/study/attempt/${att.id}`);
  await expect(page.getByRole('heading', { name: 'Graded' })).toBeVisible();
});

// ---------- progress, patterns ----------

test('chapter progress: weak means scored / max below 0.5, counted from graded attempts only', async ({ request }) => {
  const c = await setup();
  const quiz = await addMcqQuiz(c);
  await apiLogin(request, c.username);

  const first = await startApi(request, quiz.id);
  await saveApi(request, first.attemptId, { q1: 1, q2: 0, q3: 1, q4: 0 }); // chapter 1: 1/2, chapter 2: 0/2
  await submitApi(request, first.attemptId);
  const open = await startApi(request, quiz.id); // a second attempt that is never submitted
  await saveApi(request, open.attemptId, { q3: 0, q4: 3 });

  const r = await request.get(`/api/study/progress?subjectId=${c.subjectId}`);
  expect(r.status()).toBe(200);
  const rows = (await r.json()) as { studentId: string; chapterTitle: string; scored: number; max: number; attempts: number }[];
  const byTitle = [...rows].sort((a, b) => a.chapterTitle.localeCompare(b.chapterTitle));
  expect(byTitle.map((x) => ({ chapter: x.chapterTitle, scored: x.scored, max: x.max, attempts: x.attempts }))).toEqual([
    { chapter: 'Chapter 1', scored: 1, max: 2, attempts: 1 },
    { chapter: 'Chapter 2', scored: 0, max: 2, attempts: 1 },
  ]);
  const weak = rows.filter((x) => x.scored / x.max < 0.5).map((x) => x.chapterTitle);
  expect(weak).toEqual(['Chapter 2']); // chapter 1 is exactly 0.5, which is not weak

  // Students only ever see their own rows, even when they ask for someone else's.
  expect(new Set(rows.map((x) => x.studentId))).toEqual(new Set([c.seed.a.student.userId]));
  const other = await request.get(`/api/study/progress?subjectId=${c.subjectId}&studentIds=${c.seed.a.teacherId}`);
  expect(((await other.json()) as { studentId: string }[]).every((x) => x.studentId === c.seed.a.student.userId)).toBe(true);
});

test('exam patterns: a student sees the patterns for their grade and cannot start a mock with another grade pattern', async ({ request }) => {
  const c = await setup();
  await apiLogin(request, c.username);
  const r = await request.get('/api/study/patterns');
  expect(r.status()).toBe(200);
  const keys = ((await r.json()) as { key: string }[]).map((p) => p.key);
  expect(keys).toContain('junior_50');
  expect(keys).not.toContain('standard_80'); // grades 9 to 12 only

  const wrong = await request.post('/api/study/artifacts', {
    data: { type: 'mock_exam', subjectId: c.subjectId, chapterIds: [c.chapters[0]], patternKey: 'standard_80' },
  });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error.message).toBe('That exam pattern is not available for your grade');

  const ok = await request.post('/api/study/artifacts', {
    data: { type: 'mock_exam', subjectId: c.subjectId, chapterIds: [c.chapters[0]], patternKey: 'junior_50' },
  });
  expect(ok.status()).toBe(201);
  const [row] = await artifactRowsOf(c.seed.a.student.userId!, 'mock_exam');
  expect(row.params).toMatchObject({ patternKey: 'junior_50' });
});

// ---------- privacy and access ----------

test('answer keys are not sent before submit; they appear only in the review after submit', async ({ request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await apiLogin(request, c.username);
  const artifactText = await (await request.get(`/api/study/artifacts/${quiz.id}`)).text();
  expect(artifactText).not.toMatch(/correctIndex|modelAnswer|rubric/);

  const st = await startApi(request, quiz.id);
  const during = await (await request.get(`/api/study/attempts/${st.attemptId}`)).json();
  expect(during).not.toHaveProperty('results');
  expect(during).not.toHaveProperty('questions');
  expect(JSON.stringify(during)).not.toMatch(/correctIndex|modelAnswer|rubric/);

  await submitApi(request, st.attemptId);
  const after = await (await request.get(`/api/study/attempts/${st.attemptId}`)).text();
  expect(after).toMatch(/correctIndex/); // review data only after submit
});

test('another student cannot see or touch this student attempt or artifact', async ({ browser, request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
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
  const peerActor: Actor = {
    userId: peer.studentUserId,
    isPlatformAdmin: false,
    schoolId: c.seed.a.schoolId,
    branchId: c.seed.a.branchId,
    roles: ['student'],
  };
  await activateStudent(peerActor);

  await apiLogin(request, c.username);
  const st = await startApi(request, quiz.id);
  await saveApi(request, st.attemptId, { q1: 1 });

  const peerApi = await pwRequest.newContext({ baseURL: APP_URL });
  try {
    await apiLogin(peerApi, 'peer.kid');
    expect((await peerApi.get(`/api/study/artifacts/${quiz.id}`)).status()).toBe(404);
    expect((await peerApi.post(`/api/study/artifacts/${quiz.id}/attempts`)).status()).toBe(404);
    const view = await peerApi.get(`/api/study/attempts/${st.attemptId}`);
    expect(view.status()).toBe(404);
    expect((await view.json()).error.code).toBe('NOT_FOUND');
    const put = await peerApi.put(`/api/study/attempts/${st.attemptId}/answers`, { data: { answers: { q1: 0 } } });
    expect(put.status()).toBe(404);
    expect((await peerApi.post(`/api/study/attempts/${st.attemptId}/submit`)).status()).toBe(404);
    expect(await (await peerApi.get('/api/study/artifacts')).json()).toEqual([]);
  } finally {
    await peerApi.dispose();
  }

  const [still] = await attemptRows(quiz.id);
  expect(still.answers).toEqual({ q1: 1 });
  expect(still.status).toBe('in_progress');

  const peerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const peerPage: Page = await peerCtx.newPage();
    await uiLogin(peerPage, 'peer.kid');
    await peerPage.goto(`/learn/study/a/${quiz.id}`);
    await expect(peerPage.getByText('Not found.')).toBeVisible();
    await peerPage.goto(`/learn/study/attempt/${st.attemptId}`);
    await expect(peerPage.getByText('Could not load this attempt.')).toBeVisible();
    await peerPage.goto('/learn/study');
    await expect(peerPage.getByText('Nothing here yet. Create one above.')).toBeVisible();
  } finally {
    await peerCtx.close();
  }
});

test('unauthenticated and wrong-role callers are refused by the study API and pages', async ({ page, request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);

  const anon = await request.get('/api/study/artifacts');
  expect(anon.status()).toBe(401);

  const teacherName = await usernameOf(c.seed.a.teacher.userId!);
  await apiLogin(request, teacherName);
  expect((await request.get('/api/study/artifacts')).status()).toBe(403);
  const create = await request.post('/api/study/artifacts', {
    data: { type: 'practice_test', subjectId: c.subjectId, chapterIds: [c.chapters[0]], questionCount: 5 },
  });
  expect(create.status()).toBe(403);
  expect((await create.json()).error.code).toBe('FORBIDDEN');
  expect((await request.get(`/api/study/artifacts/${quiz.id}`)).status()).toBe(403);

  await uiLogin(page, teacherName, /^(?!.*\/login).*$/);
  await page.goto('/learn/study');
  await page.waitForURL((u) => !u.pathname.startsWith('/learn/study'));
  expect(new URL(page.url()).pathname.startsWith('/learn/study')).toBe(false);
});

test('a student who is not active is sent to /status and refused by the study API', async ({ page, request }) => {
  const c = await setup();
  const quiz = await addQuiz(c);
  await signupWithCode({
    code: c.seed.a.code,
    grade: 8,
    studentName: 'Pending Kid',
    parentName: 'Pending Parent',
    parentPhone: '9000000003',
    planId: c.seed.planId,
    username: 'pending.kid',
    password: SEED_PASSWORD,
  });

  await uiLogin(page, 'pending.kid', /\/status$/);
  await page.goto('/learn/study');
  await expect(page).toHaveURL(/\/status$/);

  await apiLogin(request, 'pending.kid');
  expect((await request.get('/api/study/artifacts')).status()).toBe(403);
  expect((await request.get(`/api/study/artifacts/${quiz.id}`)).status()).toBe(403);
  expect((await request.post(`/api/study/artifacts/${quiz.id}/attempts`)).status()).toBe(403);
});

test('ids that are not UUIDs get a 404 envelope, and the study page shows Not found', async ({ page, request }) => {
  const c = await setup();
  await apiLogin(request, c.username);
  for (const r of [
    await request.get('/api/study/artifacts/not-a-uuid'),
    await request.get('/api/study/attempts/not-a-uuid'),
    await request.post('/api/study/attempts/not-a-uuid/submit'),
    await request.post('/api/study/artifacts/not-a-uuid/attempts'),
  ]) {
    expect(r.status()).toBe(404);
    expect((await r.json()).error.code).toBe('NOT_FOUND');
  }
  await uiLogin(page, c.username);
  await page.goto('/learn/study/a/not-a-uuid');
  await expect(page.getByText('Not found.')).toBeVisible();
});

// ---------- mobile layout ----------

test('mobile 390px: the take page and the review have no horizontal scroll, and controls are reachable', async ({ page }) => {
  const c = await setup();
  const [c1] = c.chapters;
  const [k1] = c.chunks;
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const quiz = await addCustomQuiz(c, [
    mcq({
      id: 'q1',
      prompt: `${long}?`,
      options: [`${long} alpha`, `${long} beta`, `${long} gamma`, `${long} delta`],
      correctIndex: 0,
      chapterId: c1,
      chunkIds: [k1],
    }),
    short({ id: 'q2', prompt: `${long}.`, chapterId: c1, chunkIds: [k1] }),
  ]);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 2')).toBeVisible();
  await expectNoHorizontalScroll(page);

  const next = page.getByRole('button', { name: 'Next', exact: true });
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  for (const control of [next, submit]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box, 'control is rendered').not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  }
  await page.getByRole('radio').nth(2).check();
  await next.click();
  await expect(page.getByText('Question 2 of 2')).toBeVisible();
  await page.getByLabel('Your answer').fill('A short answer.');
  await submit.click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  // The short answer goes to the grader, which does not run in e2e, so the attempt stays in grading.
  await expect(page.getByText('Grading…')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('a long unbroken word in a question does not push the take page wider than the screen', async ({ page }) => {
  const c = await setup();
  const [c1] = c.chapters;
  const [k1] = c.chunks;
  const token = 'Supercalifragilisticexpialidocious'.repeat(3);
  const quiz = await addCustomQuiz(c, [
    mcq({ id: 'q1', prompt: `Define ${token}`, options: [token, 'short', 'b', 'c'], correctIndex: 1, chapterId: c1, chunkIds: [k1] }),
    short({ id: 'q2', prompt: 'Explain.', chapterId: c1, chunkIds: [k1] }),
  ]);
  await uiLogin(page, c.username);
  await page.goto(`/learn/study/a/${quiz.id}`);
  await page.getByRole('link', { name: 'Start test' }).click();
  await expect(page.getByText('Question 1 of 2')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
