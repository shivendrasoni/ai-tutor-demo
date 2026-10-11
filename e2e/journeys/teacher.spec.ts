import { eq } from 'drizzle-orm';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { artifacts, attempts, sections, skills, subjects, users } from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import { assignTeacher, createStaffUser } from '@/modules/tenancy';
import { buildPdf } from '../../tests/helpers/pdfs';
import {
  insertChapter, insertGradedAttempt, insertMessage, seedAnalyticsWorld,
} from '../../tests/helpers/analytics-seed';
import { resetDb, SEED_PASSWORD } from '../../tests/helpers/db';
import type { Creds } from '../helpers/seed';

/** Logs in through the form and waits for the landing URL, so the session cookie is set before the next step. */
async function signIn(page: Page, c: Creds, landing: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(c.username);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(landing);
}
const TEACHER = /\/teacher(\?|$)/;
const STATUS = /\/status$/;

/*
 * Teacher journeys (/teacher, /teacher/materials, /api/teacher/*). Every test re-seeds the world (resetDb + helpers)
 * so tests are independent. Viewport is 390px (mobile-chromium project).
 *
 * World (school A, branch A1):
 *   8-A  (grade 8)  students: "student A" (seed), "Student s_active1", "Student s_active2", "Student s_lapsed",
 *                   plus "Student s_removed" (removed, must never appear)
 *   8-B  (grade 8)  no students
 *   9-A  (grade 9)  NOT assigned to the teacher
 *   subjects: Mathematics (assigned to 8-A), Science (assigned to 8-A), English (assigned to 8-A, no chapters),
 *             Hindi (never assigned)
 *   teacher assignments: 8-A/Mathematics, 8-A/Science, 8-A/English, 8-B/Mathematics
 */

test.use({ viewport: { width: 390, height: 844 } });

const H = 3_600_000;
const D = 86_400_000;
const dateOf = (t: number) => new Date(t).toISOString().slice(0, 10);

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function insertInProgressAttempt(o: {
  schoolId: string; studentId: string; subjectId: string; byChapter: Record<string, { scored: number; max: number }>;
}): Promise<void> {
  await seedSkills();
  await withPlatform(async (tx) => {
    const [skill] = await tx.select({ id: skills.id }).from(skills).where(eq(skills.key, 'socratic'));
    const [a] = await tx
      .insert(artifacts)
      .values({
        schoolId: o.schoolId, studentId: o.studentId, skillId: skill.id, type: 'practice_test', subjectId: o.subjectId,
        chapterIds: Object.keys(o.byChapter), status: 'ready', content: { questions: [] }, params: { chapterTitles: {} },
      })
      .returning({ id: artifacts.id });
    await tx.insert(attempts).values({
      schoolId: o.schoolId, artifactId: a.id, studentId: o.studentId, status: 'in_progress',
      byChapter: o.byChapter, score: '0', maxScore: '10',
    });
  });
}

async function seedTeacherWorld() {
  await resetDb();
  const w = await seedAnalyticsWorld();
  const A = w.a;
  const admin = A.schoolAdmin;
  const teacher = A.teacher;

  const subj = await withPlatform((tx) =>
    tx
      .insert(subjects)
      .values([
        { schoolId: A.schoolId, name: 'English' },
        { schoolId: A.schoolId, name: 'Hindi' },
      ])
      .returning({ id: subjects.id, name: subjects.name }),
  );
  const englishId = subj.find((s) => s.name === 'English')!.id;
  const hindiId = subj.find((s) => s.name === 'Hindi')!.id;

  const [sec8b] = await withPlatform((tx) =>
    tx.insert(sections).values({ schoolId: A.schoolId, branchId: A.branchId, grade: 8, name: '8-B' }).returning({ id: sections.id }),
  );

  await assignTeacher(admin, { teacherId: teacher.userId, sectionId: A.sectionId, subjectId: w.aSubject2Id });
  await assignTeacher(admin, { teacherId: teacher.userId, sectionId: A.sectionId, subjectId: englishId });
  await assignTeacher(admin, { teacherId: teacher.userId, sectionId: sec8b.id, subjectId: A.subjectId });

  const algebra = await insertChapter({
    schoolId: A.schoolId, branchId: A.branchId, sectionId: A.sectionId, subjectId: A.subjectId, grade: 8, title: 'Algebra',
  });
  const geometry = await insertChapter({
    schoolId: A.schoolId, branchId: A.branchId, sectionId: A.sectionId, subjectId: A.subjectId, grade: 8, title: 'Geometry',
  });
  const mensuration = await insertChapter({
    schoolId: A.schoolId, branchId: A.branchId, sectionId: A.sectionId, subjectId: A.subjectId, grade: 8, title: 'Mensuration',
  });
  const plants = await insertChapter({
    schoolId: A.schoolId, branchId: A.branchId, sectionId: A.sectionId, subjectId: w.aSubject2Id, grade: 8, title: 'Plants',
  });

  const s1 = w.aActive1.userId;
  const s2 = w.aActive2.userId;
  // Graded attempts count; s1 Algebra 2/10 (+ s2 5/10) gives an Algebra average of 7/20 = 35% (weak).
  await insertGradedAttempt({
    schoolId: A.schoolId, studentId: s1, subjectId: A.subjectId,
    byChapter: { [algebra.chapterId]: { scored: 2, max: 10 }, [geometry.chapterId]: { scored: 8, max: 10 } },
  });
  await insertGradedAttempt({
    schoolId: A.schoolId, studentId: s2, subjectId: A.subjectId,
    byChapter: { [algebra.chapterId]: { scored: 5, max: 10 } },
  });
  // An attempt that is not graded must not count toward Mensuration.
  await insertInProgressAttempt({
    schoolId: A.schoolId, studentId: s2, subjectId: A.subjectId, byChapter: { [mensuration.chapterId]: { scored: 0, max: 10 } },
  });

  // Usage: s1 has 3 user messages in the last 7 days, 2 more 10 days ago, plus one assistant message (not counted).
  const now = Date.now();
  for (const h of [1, 2, 3]) {
    await insertMessage({ schoolId: A.schoolId, studentId: s1, role: 'user', createdAt: new Date(now - h * H), subjectId: A.subjectId });
  }
  await insertMessage({
    schoolId: A.schoolId, studentId: s1, role: 'assistant', createdAt: new Date(now - H), subjectId: A.subjectId,
    model: 'mock', content: 'answer',
  });
  for (const _ of [1, 2]) {
    await insertMessage({ schoolId: A.schoolId, studentId: s1, role: 'user', createdAt: new Date(now - 10 * D), subjectId: A.subjectId });
  }
  // s2: one message 20 days ago in Mathematics (30d only); one message 1h ago in Science.
  await insertMessage({ schoolId: A.schoolId, studentId: s2, role: 'user', createdAt: new Date(now - 20 * D), subjectId: A.subjectId });
  await insertMessage({ schoolId: A.schoolId, studentId: s2, role: 'user', createdAt: new Date(now - H), subjectId: w.aSubject2Id });

  // A teacher with no assignments at all.
  const empty = await createStaffUser(admin, {
    schoolId: A.schoolId, branchId: A.branchId, role: 'teacher', username: 'empty_teacher', password: SEED_PASSWORD,
    name: 'Empty Teacher',
  });

  const creds = async (userId: string, password = SEED_PASSWORD): Promise<Creds> => ({
    username: await usernameOf(userId), password,
  });

  return {
    world: w,
    ids: {
      schoolId: A.schoolId,
      sec8a: A.sectionId,
      sec8b: sec8b.id,
      sec9a: w.aSection9Id,
      branchA: A.branchId,
      subMath: A.subjectId,
      subSci: w.aSubject2Id,
      subEnglish: englishId,
      subHindi: hindiId,
      s1, s2, lapsed: w.aLapsedId, seedStudent: A.studentId,
      bSectionId: w.b.sectionId,
      bSubjectId: w.b.subjectId,
    },
    time: { oneHourAgo: dateOf(now - H), twentyDaysAgo: dateOf(now - 20 * D) },
    teacher: await creds(teacher.userId),
    emptyTeacher: await creds(empty.userId),
    pendingStudent: await creds(A.studentId),
    schoolAdmin: await creds(admin.userId!),
  };
}

type TeacherWorld = Awaited<ReturnType<typeof seedTeacherWorld>>;
let t: TeacherWorld;

test.beforeEach(async () => {
  t = await seedTeacherWorld();
});

const q = (sectionId: string, subjectId: string) => `sectionId=${sectionId}&subjectId=${subjectId}`;
const progressCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Progress', exact: true }) });
const usageCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tutor usage', exact: true }) });

/** Selects an option and retries until the control keeps it (the client form can reset a select during hydration). */
async function choose(form: Locator, label: string, optionText: string): Promise<void> {
  const control = form.getByLabel(label, { exact: true });
  await expect(async () => {
    await control.selectOption({ label: optionText });
    await expect(control.locator('option:checked')).toHaveText(optionText);
  }).toPass();
}
const cellTexts = async (row: Locator) => row.locator('th,td').allTextContents();

async function getJson(page: Page, path: string) {
  const res = await page.request.get(path);
  return { status: res.status(), body: await res.json().catch(() => null) as unknown };
}

type ErrBody = { error?: { code?: string; message?: string } };

test.describe('teacher journeys', () => {
  test('teacher logs in, lands on /teacher, and sees only a Home link and Log out in the header', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Account' });
    await expect(nav.getByRole('link')).toHaveText(['Home']);
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/teacher');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('section selector lists only the assigned section x subject pairs and the first pair is selected by default', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
    const links = page.locator('ul li a');
    await expect(links).toHaveText(['8-A · English', '8-A · Mathematics', '8-A · Science', '8-B · Mathematics']);
    await expect(page.getByRole('link', { name: /9-A/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Hindi/ })).toHaveCount(0);
    // Default selection = first assignment in (grade, section name, subject name) order: 8-A · English, no chapters.
    await expect(page.getByRole('link', { name: '8-A · English' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('No chapters available for this subject yet')).toBeVisible();
  });

  test('switching section x subject updates the progress grid and the usage table', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
    await page.getByRole('link', { name: '8-A · Mathematics' }).click();
    await expect(page).toHaveURL(new RegExp(`subjectId=${t.ids.subMath}`));
    await expect(page.getByRole('link', { name: '8-A · Mathematics' })).toHaveAttribute('aria-current', 'page');
    await expect(progressCard(page).getByRole('columnheader', { name: /Algebra/ })).toBeVisible();

    await page.getByRole('link', { name: '8-A · Science' }).click();
    await expect(page).toHaveURL(new RegExp(`subjectId=${t.ids.subSci}`));
    await expect(page.getByRole('link', { name: '8-A · Science' })).toHaveAttribute('aria-current', 'page');
    const grid = progressCard(page);
    await expect(grid.getByRole('columnheader', { name: /Plants/ })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: /Algebra/ })).toHaveCount(0);
    // Science usage: s1 has no Science messages; s2's single Science message is 1h old.
    const s1Row = usageCard(page).getByRole('row', { name: /Student s_active1/ });
    expect(await cellTexts(s1Row)).toEqual(['Student s_active1', '8-A', '0', '0', '—']);
    const s2Row = usageCard(page).getByRole('row', { name: /Student s_active2/ });
    expect(await cellTexts(s2Row)).toEqual(['Student s_active2', '8-A', '1', '1', t.time.oneHourAgo]);
  });

  test('progress grid shows per-student chapter percentages and marks only graded weak chapters', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?${q(t.ids.sec8a, t.ids.subMath)}`);
    const grid = progressCard(page);
    await expect(grid.getByRole('columnheader', { name: /Algebra/ })).toBeVisible();

    // Chapter headers: Algebra avg 7/20 = 35% (weak), Geometry 8/10 = 80%, Mensuration has only an ungraded attempt -> no weakness.
    const weak = grid.locator('th[data-weak="true"]');
    await expect(weak).toHaveCount(1);
    await expect(weak).toContainText('Algebra');
    await expect(weak).toContainText('35%');
    const geometry = grid.locator('thead th').filter({ hasText: 'Geometry' });
    await expect(geometry).toContainText('80%');
    await expect(geometry).not.toHaveAttribute('data-weak', 'true');
    const mensuration = grid.locator('thead th').filter({ hasText: 'Mensuration' });
    await expect(mensuration).toContainText('—');
    await expect(mensuration).not.toHaveAttribute('data-weak', 'true');

    // Per-student cells: s1 Algebra 2/10 = 20%; s2 Algebra 5/10 = 50% (exactly 0.5 is not weak); ungraded = —.
    expect(await cellTexts(grid.getByRole('row', { name: /Student s_active1/ }))).toEqual(['Student s_active1', '20%', '80%', '—']);
    expect(await cellTexts(grid.getByRole('row', { name: /Student s_active2/ }))).toEqual(['Student s_active2', '50%', '—', '—']);
    expect(await cellTexts(grid.getByRole('row', { name: /Student s_lapsed/ }))).toEqual(['Student s_lapsed', '—', '—', '—']);
    expect(await cellTexts(grid.getByRole('row', { name: /^student A/ }))).toEqual(['student A', '—', '—', '—']);
    // Removed students never appear.
    await expect(grid.getByText('Student s_removed')).toHaveCount(0);
  });

  test('usage table shows 7-day and 30-day message counts and last active date per student', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?${q(t.ids.sec8a, t.ids.subMath)}`);
    const usage = usageCard(page);
    await expect(usage.getByRole('columnheader', { name: 'Messages (7 days)' })).toBeVisible();
    // s1: 3 user messages in 7d, 5 in 30d (assistant message excluded); last active 1h ago.
    expect(await cellTexts(usage.getByRole('row', { name: /Student s_active1/ }))).toEqual([
      'Student s_active1', '8-A', '3', '5', t.time.oneHourAgo,
    ]);
    // s2: the 20-day-old message counts in 30d only.
    expect(await cellTexts(usage.getByRole('row', { name: /Student s_active2/ }))).toEqual([
      'Student s_active2', '8-A', '0', '1', t.time.twentyDaysAgo,
    ]);
    // No messages at all -> zeros and no last active date.
    expect(await cellTexts(usage.getByRole('row', { name: /Student s_lapsed/ }))).toEqual(['Student s_lapsed', '8-A', '0', '0', '—']);
    await expect(usage.getByRole('row', { name: /Student s_removed/ })).toHaveCount(0);
  });

  test('API: assigned pair returns progress and usage; unassigned subject and section return 403 FORBIDDEN', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);

    const ok = await getJson(page, `/api/teacher/progress?${q(t.ids.sec8a, t.ids.subMath)}`);
    expect(ok.status).toBe(200);
    const progress = (ok.body as { progress: { chapters: { title: string; weak: boolean }[] } }).progress;
    expect(progress.chapters.map((c) => [c.title, c.weak])).toEqual([['Algebra', true], ['Geometry', false], ['Mensuration', false]]);

    const usage = await getJson(page, `/api/teacher/usage?${q(t.ids.sec8a, t.ids.subMath)}`);
    expect(usage.status).toBe(200);
    expect((usage.body as { usage: unknown[] }).usage).toHaveLength(4);

    // Same section, subject never assigned to this teacher.
    for (const path of ['progress', 'usage']) {
      const r = await getJson(page, `/api/teacher/${path}?${q(t.ids.sec8a, t.ids.subHindi)}`);
      expect(r.status, `${path} unassigned subject`).toBe(403);
      expect((r.body as ErrBody).error?.code).toBe('FORBIDDEN');
    }
    // Assigned subject, section the teacher does not teach (9-A).
    for (const path of ['progress', 'usage']) {
      const r = await getJson(page, `/api/teacher/${path}?${q(t.ids.sec9a, t.ids.subMath)}`);
      expect(r.status, `${path} unassigned section`).toBe(403);
      expect((r.body as ErrBody).error?.code).toBe('FORBIDDEN');
    }
    // Assigned section id is fine but the subject is a valid uuid that is not assigned to this section (8-B has Math only).
    const crossPair = await getJson(page, `/api/teacher/progress?${q(t.ids.sec8b, t.ids.subSci)}`);
    expect(crossPair.status).toBe(403);
  });

  test('API: another school\'s section never leaks data (404 or 403, no progress body)', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    const progress = await getJson(page, `/api/teacher/progress?${q(t.ids.bSectionId, t.ids.subMath)}`);
    expect([403, 404]).toContain(progress.status);
    expect(progress.body).not.toHaveProperty('progress');
    const usage = await getJson(page, `/api/teacher/usage?${q(t.ids.bSectionId, t.ids.subMath)}`);
    expect([403, 404]).toContain(usage.status);
    expect(usage.body).not.toHaveProperty('usage');
  });

  test('API: malformed ids return 400 VALIDATION, missing ids 400, and no session 401', async ({ page, request }) => {
    await signIn(page, t.teacher, TEACHER);
    for (const path of ['progress', 'usage']) {
      const bad = await getJson(page, `/api/teacher/${path}?sectionId=not-a-uuid&subjectId=${t.ids.subMath}`);
      expect(bad.status, `${path} malformed`).toBe(400);
      expect((bad.body as ErrBody).error?.code).toBe('VALIDATION');
      const missing = await getJson(page, `/api/teacher/${path}?sectionId=${t.ids.sec8a}`);
      expect(missing.status, `${path} missing subject`).toBe(400);
      expect((missing.body as ErrBody).error?.code).toBe('VALIDATION');
    }
    // A fresh request context has no session cookie.
    for (const path of ['progress', 'usage']) {
      const anon = await request.get(`/api/teacher/${path}?${q(t.ids.sec8a, t.ids.subMath)}`);
      expect(anon.status(), `${path} anonymous`).toBe(401);
      expect(((await anon.json()) as ErrBody).error?.code).toBe('UNAUTHENTICATED');
    }
  });

  test('a teacher opening an unassigned section or subject in the page sees "Not allowed"', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?${q(t.ids.sec9a, t.ids.subMath)}`);
    await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
    await expect(page.getByText('Your account does not have access to this page.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toHaveCount(0);

    await page.goto(`/teacher?${q(t.ids.sec8a, t.ids.subHindi)}`);
    await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
  });

  test('sending only one of sectionId / subjectId shows the validation message, not an error page', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?sectionId=${t.ids.sec8a}`);
    await expect(page.getByText('Choose both a section and a subject')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your classes' })).toBeVisible();
  });

  test('a teacher cannot open /school or /platform and is sent to /teacher', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
    await page.goto('/school');
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
    await page.goto('/platform');
    await expect(page).toHaveURL(/\/teacher(\?|$)/);
  });

  test('a student cannot open /teacher or /teacher/materials and is sent to /status (pending payment)', async ({ browser }) => {
    // Only the pending seed student can log in: the other students from seedAnalyticsWorld have no password hash,
    // and an active student would need a payment, which is out of scope for these journeys.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const pending = await ctx.newPage();
      await signIn(pending, t.pendingStudent, STATUS);
      await pending.goto('/teacher');
      await expect(pending).toHaveURL(STATUS);
      await pending.goto(`/teacher?${q(t.ids.sec8a, t.ids.subMath)}`);
      await expect(pending).toHaveURL(STATUS);
      // Student API access is refused for the teacher endpoints.
      for (const path of ['progress', 'usage']) {
        const api = await getJson(pending, `/api/teacher/${path}?${q(t.ids.sec8a, t.ids.subMath)}`);
        expect(api.status, path).toBe(403);
        expect((api.body as ErrBody).error?.code).toBe('FORBIDDEN');
      }
    } finally {
      await ctx.close();
    }
  });

  test('an anonymous visitor to /teacher is sent to /login', async ({ page }) => {
    await page.goto('/teacher');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a teacher with no assignments sees the empty state, not an error', async ({ page }) => {
    await signIn(page, t.emptyTeacher, TEACHER);
    await expect(page.getByRole('heading', { name: 'Teacher', exact: true })).toBeVisible();
    await expect(page.getByText('No classes assigned yet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Tutor usage', exact: true })).toHaveCount(0);
    await expect(page.getByText('Not allowed')).toHaveCount(0);
    // Materials link is still offered; the API refuses any pair.
    await expect(page.getByRole('link', { name: 'Materials' })).toBeVisible();
    const r = await getJson(page, `/api/teacher/progress?${q(t.ids.sec8a, t.ids.subMath)}`);
    expect(r.status).toBe(403);
  });

  test('empty states: a section with no students, and a subject with no chapters', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?${q(t.ids.sec8b, t.ids.subMath)}`);
    await expect(page.getByText('No students in this section yet')).toBeVisible();
    await expect(usageCard(page).getByText('No usage yet')).toBeVisible();

    await page.goto(`/teacher?${q(t.ids.sec8a, t.ids.subEnglish)}`);
    await expect(page.getByText('No chapters available for this subject yet')).toBeVisible();
    await expect(usageCard(page).getByRole('row', { name: /Student s_active1/ })).toBeVisible();
  });

  test('materials page: upload form offers only assigned sections and subjects, and a PDF upload is listed', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.getByRole('link', { name: 'Materials' }).first().click();
    await expect(page).toHaveURL(/\/teacher\/materials$/);
    await expect(page.getByRole('heading', { name: 'Materials', exact: true })).toBeVisible();
    await expect(page.getByText('Share PDF materials with the sections you teach.')).toBeVisible();

    const form = page.getByRole('form', { name: 'Upload content' });
    await choose(form, 'Branch', 'Branch A');
    await choose(form, 'Grade', '8');
    await choose(form, 'Section', '8-A');
    const subjectOptions = await form.getByLabel('Subject', { exact: true }).locator('option').allTextContents();
    expect(subjectOptions.map((s) => s.trim())).toEqual(['Select a subject', 'English', 'Mathematics', 'Science']);

    await form.getByLabel('Title', { exact: true }).fill('Fractions workbook');
    await choose(form, 'Subject', 'Mathematics');
    await form.getByLabel('PDF file').setInputFiles({
      name: 'fractions.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await buildPdf({ pages: ['Fractions are parts of a whole.'] })),
    });
    await form.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('status').getByText('Uploaded. Processing will start shortly.')).toBeVisible();
    const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Fractions workbook' }) });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Material · Mathematics · Grade 8 · Section');
    await expect(item).toContainText(/Queued|Processing|Ready|Failed/);
  });

  test('materials page: a non-PDF file is rejected with a clear message', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto('/teacher/materials');
    const form = page.getByRole('form', { name: 'Upload content' });
    await form.getByLabel('Title', { exact: true }).fill('Not a PDF');
    await choose(form, 'Branch', 'Branch A');
    await choose(form, 'Grade', '8');
    await choose(form, 'Section', '8-A');
    await choose(form, 'Subject', 'Mathematics');
    await form.getByLabel('PDF file').setInputFiles({
      name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is plain text, not a pdf'),
    });
    await form.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('alert').getByText('Only PDF files are accepted.')).toBeVisible();
  });

  test('API: a teacher cannot upload a material to an unassigned section or subject', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    const pdf = Buffer.from(await buildPdf({ pages: ['x'] }));
    const cases = [
      { sectionId: t.ids.sec9a, subjectId: t.ids.subMath, grade: '9' }, // not assigned section (grade matches it)
      { sectionId: t.ids.sec8a, subjectId: t.ids.subHindi, grade: '8' }, // assigned section, unassigned subject
    ];
    for (const { sectionId, subjectId, grade } of cases) {
      const res = await page.request.post('/api/content', {
        multipart: {
          file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: pdf },
          title: 'Sneaky upload',
          kind: 'material',
          scope: 'section',
          grade,
          branchId: t.ids.branchA,
          subjectId,
          sectionId,
        },
      });
      expect(res.status(), `upload to ${sectionId}/${subjectId}`).toBe(403);
      expect(((await res.json()) as ErrBody).error?.code).toBe('FORBIDDEN');
    }
  });

  test('a student cannot open /teacher/materials', async ({ page }) => {
    await signIn(page, t.pendingStudent, STATUS);
    await page.goto('/teacher/materials');
    await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Materials', exact: true })).toHaveCount(0);
  });

  test('staff header: Home returns to /teacher, and Log out returns to /login and ends the session', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto('/teacher/materials');
    await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/teacher(\?|$)/);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/teacher');
    await expect(page).toHaveURL(/\/login$/);
    const after = await page.request.get(`/api/teacher/progress?${q(t.ids.sec8a, t.ids.subMath)}`);
    expect(after.status()).toBe(401);
  });

  test('mobile 390px: /teacher with the progress grid and usage table has no horizontal page scroll', async ({ page }) => {
    await signIn(page, t.teacher, TEACHER);
    await page.goto(`/teacher?${q(t.ids.sec8a, t.ids.subMath)}`);
    await expect(page.getByRole('columnheader', { name: /Algebra/ })).toBeVisible();
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

