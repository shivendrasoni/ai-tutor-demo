import { and, eq } from 'drizzle-orm';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { withPlatform } from '@/db/client';
import { studentProfiles, teacherAssignments, users } from '@/db/schema';
import { manualAddStudent, signupWithCode } from '@/modules/enrollment';
import { createBranch, createSection, createStaffUser } from '@/modules/tenancy';
import { currentCode, resetDb, SEED_PASSWORD, seedTwoSchools } from '../../tests/helpers/db';
import { login } from '../helpers/seed';

/*
 * School-admin journeys: the /school dashboard, adding, inviting, removing and resetting students, branch
 * signup codes, the Setup forms, tenant and branch isolation, the staff header, and the 390px layout.
 * Every test resets and reseeds the DB. Accounts come from seedTwoSchools() plus the services the admin CLI
 * uses (createBranch, createSection, createStaffUser, manualAddStudent, signupWithCode). Payments are out of
 * scope, so no student in these tests becomes active or lapsed.
 */

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const VIEWPORT = { width: 390, height: 844 };

type Creds = { username: string; password: string };

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function credsOf(userId: string): Promise<Creds> {
  return { username: await usernameOf(userId), password: SEED_PASSWORD };
}

/**
 * School A: Branch A (seeded, grade 8 section 8-A), Branch A2 (grade 9 section 9-X, one student) and Branch A3
 * (empty). Students: "student A" (seeded), "Removable Kid" (grade 8, signed up), "Asha Rao" (grade 9, section 9-A),
 * "A2 Student" (Branch A2). Teacher "teacher A" (seeded) and "Teacher A2" (Branch A2).
 */
async function setupWorld() {
  await resetDb();
  const seed = await seedTwoSchools();
  const a = seed.a;
  const branchA2 = await createBranch(seed.platform, { schoolId: a.schoolId, name: 'Branch A2' });
  const branchA3 = await createBranch(seed.platform, { schoolId: a.schoolId, name: 'Branch A3' });
  const sectionA9 = await createSection(a.schoolAdmin, { branchId: a.branchId, grade: 9, name: '9-A' });
  const sectionA2 = await createSection(a.schoolAdmin, { branchId: branchA2.id, grade: 9, name: '9-X' });
  const teacherA2 = await createStaffUser(a.schoolAdmin, {
    schoolId: a.schoolId, branchId: branchA2.id, role: 'teacher', username: 'teacher.a2', password: SEED_PASSWORD, name: 'Teacher A2',
  });
  const kid = await signupWithCode({
    code: a.code, grade: 8, studentName: 'Removable Kid', parentName: 'Removable Parent', parentPhone: '9000000001',
    planId: seed.planId, username: 'removable.kid', password: SEED_PASSWORD,
  });
  const asha = await signupWithCode({
    code: a.code, grade: 9, sectionId: sectionA9.id, studentName: 'Asha Rao', parentName: 'Asha Parent', parentPhone: '9000000002',
    planId: seed.planId, username: 'asha.rao', password: SEED_PASSWORD,
  });
  const a2Student = await manualAddStudent(a.schoolAdmin, {
    branchId: branchA2.id, grade: 9, sectionId: sectionA2.id, studentName: 'A2 Student', parentName: 'A2 Parent', parentPhone: '9000000003',
  });
  return {
    seed,
    branchA2: { id: branchA2.id, code: branchA2.signupCode },
    branchA3: { id: branchA3.id },
    sectionA2: sectionA2.id,
    sectionA9: sectionA9.id,
    teacherA2Id: teacherA2.userId,
    kidId: kid.studentUserId,
    ashaId: asha.studentUserId,
    a2StudentId: a2Student.studentUserId,
    schoolAdmin: await credsOf(a.schoolAdmin.userId),
    branchAdmin: await credsOf(a.branchAdmin.userId),
    teacher: await credsOf(a.teacherId),
    student: await credsOf(a.studentId),
    teacherA2: { username: 'teacher.a2', password: SEED_PASSWORD } as Creds,
    kid: { username: 'removable.kid', password: SEED_PASSWORD } as Creds,
  };
}

let w: Awaited<ReturnType<typeof setupWorld>>;

test.beforeEach(async () => {
  w = await setupWorld();
});

// ---------- helpers ----------

/**
 * Logs in through the form and waits until the redirect to the user's home has landed. login() returns as
 * soon as the click is dispatched, so a goto() right after it could be overwritten by that redirect.
 */
async function signIn(page: Page, c: Creds) {
  await login(page, c);
  await expect(page).not.toHaveURL(/\/login$/);
}

/** An API context logged in as `c` (cookies are kept by the context, like a browser). */
async function apiAs(c: Creds): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/login', { data: c });
  expect(res.status(), `API login for ${c.username}`).toBe(200);
  return api;
}

/** Status of a login attempt with no session kept. */
async function loginStatus(c: Creds): Promise<number> {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    return (await api.post('/api/auth/login', { data: c })).status();
  } finally {
    await api.dispose();
  }
}

/** Asserts the HTTP status and the standard { error: { code } } envelope. */
async function expectErr(res: APIResponse, status: number, code: string) {
  const body = await res.json().catch(() => null);
  expect(res.status(), `status for ${code}`).toBe(status);
  expect(body?.error?.code, 'error code').toBe(code);
  return body;
}

async function removeViaApi(c: Creds, studentId: string) {
  const api = await apiAs(c);
  const res = await api.post(`/api/school/students/${studentId}/remove`);
  expect(res.status()).toBe(200);
}

const card = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const addStudentForm = (page: Page) => page.locator('form').filter({ has: page.getByLabel('Student name') });
const filterForm = (page: Page) => page.locator('form[action="/school"]');
const studentsTable = (page: Page) => card(page, 'Students').locator('table');
const studentRow = (page: Page, name: string) => studentsTable(page).locator('tbody tr').filter({ hasText: name });
const codesCard = (page: Page) => card(page, 'Branch signup codes');
const branchRow = (page: Page, name: string) =>
  codesCard(page).locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });
/** The value of one stat tile in the Enrollment card (the tile's first child div). */
const statValue = (page: Page, label: string) =>
  card(page, 'Enrollment').locator(`div:has(> div:text-is("${label}"))`).locator('xpath=./div[1]');

/** Text of every data cell per body row of a table (header rows excluded). */
async function rowsOf(table: Locator): Promise<string[][]> {
  return table.locator('tr:has(td)').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  );
}

async function optionsOf(select: Locator): Promise<string[]> {
  return (await select.locator('option').allTextContents()).map((s) => s.trim());
}

async function addStudent(
  page: Page,
  s: { branch?: string; grade?: string; section?: string; name: string; parent: string; phone: string },
) {
  const form = addStudentForm(page);
  if (s.branch) await form.getByLabel('Branch').selectOption({ label: s.branch });
  if (s.grade) await form.getByLabel('Grade').selectOption(s.grade);
  if (s.section) await form.getByLabel('Section (optional)').selectOption({ label: s.section });
  await form.getByLabel('Student name').fill(s.name);
  await form.getByLabel('Parent name').fill(s.parent);
  await form.getByLabel('Parent phone').fill(s.phone);
  await form.getByRole('button', { name: 'Add student' }).click();
}

/** Opens a fresh browser context at /join, enters a signup code and hands the page to `check`. */
async function lookupCode(browser: Browser, code: string, check: (p: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const p = await ctx.newPage();
    await p.goto('/join');
    await p.getByLabel('Signup code').fill(code);
    await p.getByRole('button', { name: 'Continue' }).click();
    // Next's route announcer is also role=alert (and empty), so only the non-empty alert counts.
    await check(p);
  } finally {
    await ctx.close();
  }
}

// ---------- dashboard and filters ----------

test('enrollment cards and the branch-by-grade table count pending students per grade', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await expect(page).toHaveURL(/\/school$/);
  await expect(statValue(page, 'Pending payment')).toHaveText('4');
  await expect(statValue(page, 'Active')).toHaveText('0');
  await expect(statValue(page, 'Lapsed')).toHaveText('0');
  await expect(statValue(page, 'Removed')).toHaveText('0');
  const rows = await rowsOf(card(page, 'Branch by grade').locator('table'));
  expect(rows).toHaveLength(3);
  expect(rows).toEqual(expect.arrayContaining([
    ['Branch A', '8', '2', '0', '0', '0'],
    ['Branch A', '9', '1', '0', '0', '0'],
    ['Branch A2', '9', '1', '0', '0', '0'],
  ]));
});

test('a removal moves a student from pending to removed in the cards and the grade table', async ({ page }) => {
  await removeViaApi(w.schoolAdmin, w.kidId);
  await signIn(page, w.schoolAdmin);
  await expect(statValue(page, 'Pending payment')).toHaveText('3');
  await expect(statValue(page, 'Removed')).toHaveText('1');
  const rows = await rowsOf(card(page, 'Branch by grade').locator('table'));
  expect(rows).toEqual(expect.arrayContaining([['Branch A', '8', '1', '0', '0', '1']]));
});

test('the status filter narrows the students table to removed students', async ({ page }) => {
  await removeViaApi(w.schoolAdmin, w.kidId);
  await signIn(page, w.schoolAdmin);
  await filterForm(page).getByLabel('Status').selectOption('removed');
  await filterForm(page).getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page).toHaveURL(/status=removed/);
  const rows = await rowsOf(studentsTable(page));
  expect(rows.map((r) => r[0])).toEqual(['Removable Kid']);
  expect(rows[0][3]).toBe('removed');
});

test('the grade filter shows only students of that grade', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await filterForm(page).getByLabel('Grade').selectOption('9');
  await filterForm(page).getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page).toHaveURL(/grade=9/);
  const names = (await rowsOf(studentsTable(page))).map((r) => r[0]).sort();
  expect(names).toEqual(['A2 Student', 'Asha Rao']);
});

test('the branch filter shows empty states for a branch with no students', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await filterForm(page).getByLabel('Branch').selectOption({ label: 'Branch A3' });
  await filterForm(page).getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`branchId=${w.branchA3.id}`));
  await expect(card(page, 'Students').getByText('No students yet')).toBeVisible();
  await expect(card(page, 'Branch by grade').getByText('No enrollment yet')).toBeVisible();
});

test('an invalid grade or status in the URL is refused with a message', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await page.goto('/school?grade=4');
  await expect(page.getByText('Grade must be a whole number from 5 to 12')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clear filters' })).toBeVisible();
  await page.goto('/school?status=bogus');
  await expect(page.getByText('Unknown status')).toBeVisible();
});

// ---------- add a student ----------

test('school admin adds a student with a section; the invite link and the new row appear', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await addStudent(page, { branch: 'Branch A', grade: '9', section: '9-A', name: 'Kabir Shah', parent: 'Kabir Parent', phone: '9876543210' });
  await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\/[\w-]+$/);
  await expect(page.getByText('Student added. Share this invite link with the parent:')).toBeVisible();
  await expect(studentRow(page, 'Kabir Shah')).toBeVisible();
  const row = (await rowsOf(studentsTable(page))).find((r) => r[0] === 'Kabir Shah');
  expect(row?.slice(0, 4)).toEqual(['Kabir Shah', '—', '9 / 9-A', 'pending payment']);
  await expect(studentRow(page, 'Kabir Shah').getByRole('button', { name: 'New invite link' })).toBeVisible();
});

test('the section list follows the chosen grade and branch', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const form = addStudentForm(page);
  await form.getByLabel('Branch').selectOption({ label: 'Branch A' });
  await form.getByLabel('Grade').selectOption('8');
  expect(await optionsOf(form.getByLabel('Section (optional)'))).toEqual(['No section', '8-A']);
  await form.getByLabel('Grade').selectOption('9');
  expect(await optionsOf(form.getByLabel('Section (optional)'))).toEqual(['No section', '9-A']);
  await form.getByLabel('Branch').selectOption({ label: 'Branch A2' });
  expect(await optionsOf(form.getByLabel('Section (optional)'))).toEqual(['No section', '9-X']);
});

test('a blank student name is refused by the server and no student is created', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await addStudent(page, { branch: 'Branch A', grade: '8', name: '   ', parent: 'Some Parent', phone: '9876543210' });
  await expect(addStudentForm(page).getByRole('alert')).toHaveText('Invalid student details');
  await expect(page.getByLabel('Invite link')).toHaveCount(0);
  expect(await rowsOf(studentsTable(page))).toHaveLength(4);
});

test('the form blocks a missing required parent field and creates nothing', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const form = addStudentForm(page);
  await form.getByLabel('Branch').selectOption({ label: 'Branch A' });
  await form.getByLabel('Student name').fill('Only A Name');
  await form.getByRole('button', { name: 'Add student' }).click();
  const missing = await form.getByLabel('Parent name').evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
  expect(missing).toBe(true);
  await expect(page.getByLabel('Invite link')).toHaveCount(0);
  await expect(studentRow(page, 'Only A Name')).toHaveCount(0);
  expect(await rowsOf(studentsTable(page))).toHaveLength(4);
});

test('the add-student API validates input and refuses other schools and other branches', async () => {
  const admin = await apiAs(w.schoolAdmin);
  const base = { studentName: 'Api Kid', parentName: 'Api Parent', parentPhone: '9876543210' };
  await expectErr(await admin.post('/api/school/students', { data: { ...base, branchId: w.seed.a.branchId, grade: 4 } }), 400, 'VALIDATION');
  await expectErr(
    await admin.post('/api/school/students', { data: { branchId: w.seed.a.branchId, grade: 8, studentName: 'X', parentName: 'P' } }),
    400,
    'VALIDATION',
  );
  await expectErr(await admin.post('/api/school/students', { data: { ...base, branchId: w.seed.b.branchId, grade: 8 } }), 404, 'NOT_FOUND');
  const branchAdmin = await apiAs(w.branchAdmin);
  await expectErr(await branchAdmin.post('/api/school/students', { data: { ...base, branchId: w.branchA2.id, grade: 9 } }), 403, 'FORBIDDEN');
});

// ---------- invite ----------

test('a new invite link replaces the old one: the old link is dead and the new one creates the account', async ({ page, browser }) => {
  await signIn(page, w.schoolAdmin);
  await addStudent(page, { branch: 'Branch A', grade: '8', name: 'Kabir Shah', parent: 'Kabir Parent', phone: '9876543210' });
  const oldUrl = await page.getByLabel('Invite link').inputValue();
  await studentRow(page, 'Kabir Shah').getByRole('button', { name: 'New invite link' }).click();
  const issued = page.getByRole('status').filter({ hasText: 'New invite link for Kabir Shah' });
  await expect(issued).toBeVisible();
  const newUrl = await issued.getByLabel('Invite link').inputValue();
  expect(newUrl).not.toBe(oldUrl);

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const kid = await ctx.newPage();
    await kid.goto(new URL(oldUrl).pathname);
    await expect(kid.getByText('This invite link has expired or was already used. Ask your school for a new one.')).toBeVisible();
    await kid.goto(new URL(newUrl).pathname);
    await expect(kid.getByRole('heading', { name: /Set up Kabir Shah's account at/ })).toBeVisible();
    await kid.getByLabel(/Monthly/).check();
    await kid.getByLabel('Username').fill('kabir.shah');
    await kid.getByLabel('Username').blur();
    await expect(kid.getByText('kabir.shah is available.')).toBeVisible();
    await kid.getByLabel('Password').fill('kabir-shah-pass-1');
    await kid.getByRole('button', { name: 'Create account' }).click();
    await expect(kid.getByText("Account created. You'll be able to log in once your payment is confirmed.")).toBeVisible();
  } finally {
    await ctx.close();
  }

  await page.reload();
  await expect(studentRow(page, 'Kabir Shah')).toContainText('kabir.shah');
  await expect(studentRow(page, 'Kabir Shah').getByRole('button', { name: 'New invite link' })).toHaveCount(0);
});

test('a student who has already signed up cannot get a new invite link', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await expect(studentRow(page, 'Removable Kid')).toBeVisible();
  await expect(studentRow(page, 'Removable Kid').getByRole('button', { name: 'New invite link' })).toHaveCount(0);
  const admin = await apiAs(w.schoolAdmin);
  await expectErr(await admin.post(`/api/school/students/${w.kidId}/invite`), 400, 'VALIDATION');
});

// ---------- remove ----------

test('cancelling the removal confirmation keeps the student and their access', async ({ page, browser }) => {
  await signIn(page, w.schoolAdmin);
  page.once('dialog', (d) => d.dismiss());
  await studentRow(page, 'Removable Kid').getByRole('button', { name: 'Remove' }).click();
  await expect(studentRow(page, 'Removable Kid')).toContainText('pending payment');
  await expect(studentRow(page, 'Removable Kid').getByRole('button', { name: 'Remove' })).toBeVisible();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const kid = await ctx.newPage();
    await signIn(kid, w.kid);
    await expect(kid).toHaveURL(/\/status$/);
  } finally {
    await ctx.close();
  }
});

test('removing a student signs them out, shows removed, and their login is then rejected', async ({ page, browser }) => {
  const kidCtx = await browser.newContext({ viewport: VIEWPORT });
  const kidPage = await kidCtx.newPage();
  try {
    await signIn(kidPage, w.kid);
    await expect(kidPage).toHaveURL(/\/status$/);

    await signIn(page, w.schoolAdmin);
    page.once('dialog', (d) => {
      expect(d.message()).toContain('Remove Removable Kid?');
      d.accept();
    });
    await studentRow(page, 'Removable Kid').getByRole('button', { name: 'Remove' }).click();
    const row = studentRow(page, 'Removable Kid');
    await expect(row).toContainText('removed');
    await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Reset password' })).toHaveCount(0);

    await kidPage.reload();
    await expect(kidPage).toHaveURL(/\/login$/);
  } finally {
    await kidCtx.close();
  }

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const kid = await ctx.newPage();
    await login(kid, w.kid);
    await expect(kid.getByText('This account is no longer active. Contact your school.')).toBeVisible();
    await expect(kid).toHaveURL(/\/login$/);
  } finally {
    await ctx.close();
  }
});

test('the remove API cannot reach a student of another school', async ({ page }) => {
  const admin = await apiAs(w.schoolAdmin);
  await expectErr(await admin.post(`/api/school/students/${w.seed.b.studentId}/remove`), 404, 'NOT_FOUND');
  const [row] = await withPlatform((tx) =>
    tx.select({ status: studentProfiles.status }).from(studentProfiles).where(eq(studentProfiles.userId, w.seed.b.studentId)),
  );
  expect(row.status).toBe('pending_payment');
  expect(await loginStatus(await credsOf(w.seed.b.studentId))).toBe(200);
  await signIn(page, w.schoolAdmin);
  await expect(page.getByText('student B')).toHaveCount(0);
});

// ---------- reset password ----------

test('an admin password reset: the new password works, the old one fails, and the open session is signed out', async ({ page, browser }) => {
  const kidCtx = await browser.newContext({ viewport: VIEWPORT });
  const kidPage = await kidCtx.newPage();
  try {
    await signIn(kidPage, w.kid);
    await expect(kidPage).toHaveURL(/\/status$/);

    await signIn(page, w.schoolAdmin);
    const row = studentRow(page, 'Removable Kid');
    await row.getByRole('button', { name: 'Reset password' }).click();
    await row.getByLabel('New password for Removable Kid').fill('fresh-kid-pass-2');
    await row.getByRole('button', { name: 'Set password', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Password updated.' })).toBeVisible();

    await kidPage.reload();
    await expect(kidPage).toHaveURL(/\/login$/);
  } finally {
    await kidCtx.close();
  }

  const fresh = await browser.newContext({ viewport: VIEWPORT });
  try {
    const p = await fresh.newPage();
    await signIn(p, { username: 'removable.kid', password: 'fresh-kid-pass-2' });
    await expect(p).toHaveURL(/\/status$/);
  } finally {
    await fresh.close();
  }

  const old = await browser.newContext({ viewport: VIEWPORT });
  try {
    const p = await old.newPage();
    await login(p, w.kid);
    await expect(p.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Incorrect username or password.');
    await expect(p).toHaveURL(/\/login$/);
  } finally {
    await old.close();
  }
});

test('a reset is refused for a short password and for a student who has not signed up', async ({ page }) => {
  const pending = await manualAddStudent(w.seed.a.schoolAdmin, {
    branchId: w.seed.a.branchId, grade: 8, studentName: 'Pending Kid', parentName: 'PP', parentPhone: '9876543210',
  });
  await signIn(page, w.schoolAdmin);
  await expect(studentRow(page, 'Pending Kid').getByRole('button', { name: 'Reset password' })).toHaveCount(0);

  const admin = await apiAs(w.schoolAdmin);
  await expectErr(await admin.post(`/api/school/students/${w.kidId}/password`, { data: { password: 'short77' } }), 400, 'WEAK_PASSWORD');
  expect(await loginStatus(w.kid)).toBe(200); // the rejected reset changed nothing
  await expectErr(
    await admin.post(`/api/school/students/${pending.studentUserId}/password`, { data: { password: 'valid-pass-1234' } }),
    400,
    'VALIDATION',
  );
});

// ---------- branch signup codes ----------

test('rotating a branch code changes it: the old code is refused at join and the new one opens the form', async ({ page, browser }) => {
  await signIn(page, w.schoolAdmin);
  const row = branchRow(page, 'Branch A');
  const oldCode = (await row.locator('code').textContent())!.trim();
  expect(oldCode).toBe(w.seed.a.code);
  await row.getByRole('button', { name: 'Rotate' }).click();
  await expect(row.locator('code')).not.toHaveText(oldCode);
  const newCode = (await row.locator('code').textContent())!.trim();
  expect(newCode).not.toBe(oldCode);

  await lookupCode(browser, oldCode, async (p) => {
    await expect(p.getByRole('alert').filter({ hasText: /\S/ })).toHaveText("That signup code isn't valid. Check it and try again.");
  });
  await lookupCode(browser, newCode, async (p) => {
    await expect(p.getByText('Joining School A — Branch A')).toBeVisible();
  });

  const admin = await apiAs(w.schoolAdmin);
  await expectErr(await admin.post(`/api/school/branches/${w.seed.a.branchId}/code`, { data: { action: 'nudge' } }), 400, 'VALIDATION');
});

test('disabling a branch code blocks signups with it and enabling restores them', async ({ page, browser }) => {
  await signIn(page, w.schoolAdmin);
  const row = branchRow(page, 'Branch A');
  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row.getByText('disabled', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Enable' })).toBeVisible();
  await lookupCode(browser, w.seed.a.code, async (p) => {
    await expect(p.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Signups with this code are turned off. Ask your school.');
  });

  await row.getByRole('button', { name: 'Enable' }).click();
  await expect(row.getByText('enabled', { exact: true })).toBeVisible();
  await lookupCode(browser, w.seed.a.code, async (p) => {
    await expect(p.getByText('Joining School A — Branch A')).toBeVisible();
  });
});

// ---------- setup ----------

test('school admin adds a section and it becomes available to the assign form', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const form = page.getByRole('form', { name: 'Add a section' });
  await form.getByLabel('Branch').selectOption({ label: 'Branch A' });
  await form.getByLabel('Grade').selectOption('7');
  await form.getByLabel('Section name').fill('7-B');
  await form.getByRole('button', { name: 'Add section' }).click();
  await expect(form.getByRole('status')).toHaveText('Section added.');
  const assign = page.getByRole('form', { name: 'Assign a teacher' });
  await assign.getByLabel('Teacher').selectOption({ label: `teacher A (${w.teacher.username}, Branch A)` });
  expect(await optionsOf(assign.getByLabel('Section'))).toEqual(expect.arrayContaining(['7 7-B']));
});

test('school admin adds a subject; a branch admin gets no subject form and a 403 from the API', async ({ page, browser }) => {
  await signIn(page, w.schoolAdmin);
  const form = page.getByRole('form', { name: 'Add a subject' });
  await form.getByLabel('Subject name').fill('Physics');
  await form.getByRole('button', { name: 'Add subject' }).click();
  await expect(form.getByRole('status')).toHaveText('Subject added.');
  const assign = page.getByRole('form', { name: 'Assign a teacher' });
  expect(await optionsOf(assign.getByLabel('Subject'))).toEqual(expect.arrayContaining(['Mathematics', 'Physics']));

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const bp = await ctx.newPage();
    await signIn(bp, w.branchAdmin);
    await expect(bp).toHaveURL(/\/school$/);
    await expect(bp.getByRole('form', { name: 'Add a subject' })).toHaveCount(0);
    await expect(bp.getByRole('form', { name: 'Create a teacher account' })).toBeVisible();
  } finally {
    await ctx.close();
  }
  const api = await apiAs(w.branchAdmin);
  await expectErr(await api.post('/api/school/subjects', { data: { name: 'Art' } }), 403, 'FORBIDDEN');
});

test('teacher form: a bad username is refused, and a taken username offers suggestions that fill the field', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const form = page.getByRole('form', { name: 'Create a teacher account' });
  await form.getByLabel('Teacher name').fill('Dup Teacher');
  await form.getByLabel('Teacher username').fill('bad name!');
  await form.getByLabel('Teacher password').fill('dup-teacher-pass-1');
  await form.getByRole('button', { name: 'Create teacher' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('status')).toHaveCount(0);

  await form.getByLabel('Teacher username').fill(w.teacher.username);
  await form.getByRole('button', { name: 'Create teacher' }).click();
  const alert = form.getByRole('alert');
  await expect(alert).toContainText('Username is already taken');
  await expect(alert).toContainText('Try one of these:');
  const suggestion = (await alert.getByRole('button').first().textContent())!.trim();
  expect(suggestion).not.toBe('');
  await alert.getByRole('button', { name: suggestion, exact: true }).click();
  await expect(form.getByLabel('Teacher username')).toHaveValue(suggestion);

  await form.getByRole('button', { name: 'Create teacher' }).click();
  await expect(form.getByRole('status')).toContainText('Teacher account created');
  await expect(page.getByText('dup-teacher-pass-1')).toHaveCount(0);
});

test('teacher API: a short password and a bad email are refused; the email is optional', async () => {
  const admin = await apiAs(w.schoolAdmin);
  const branchId = w.seed.a.branchId;
  await expectErr(
    await admin.post('/api/school/teachers', { data: { branchId, username: 'short.pw', password: 'short', name: 'Short Pw' } }),
    400,
    'WEAK_PASSWORD',
  );
  await expectErr(
    await admin.post('/api/school/teachers', {
      data: { branchId, username: 'bad.mail', password: 'bad-mail-pass-1', name: 'Bad Mail', email: 'not-an-email' },
    }),
    400,
    'VALIDATION',
  );
  const noEmail = await admin.post('/api/school/teachers', {
    data: { branchId, username: 'no.email', password: 'no-email-pass-1', name: 'No Email' },
  });
  expect(noEmail.status()).toBe(201);
  expect((await noEmail.json()).password).toBeUndefined();
  const withEmail = await admin.post('/api/school/teachers', {
    data: { branchId, username: 'with.email', password: 'with-email-pass-1', name: 'With Email', email: 'with.email@example.com' },
  });
  expect(withEmail.status()).toBe(201);
});

test('the assign form offers only sections of the chosen teacher branch', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const assign = page.getByRole('form', { name: 'Assign a teacher' });
  await assign.getByLabel('Teacher').selectOption({ label: 'Teacher A2 (teacher.a2, Branch A2)' });
  expect(await optionsOf(assign.getByLabel('Section'))).toEqual(['9 9-X']);
  await assign.getByLabel('Teacher').selectOption({ label: `teacher A (${w.teacher.username}, Branch A)` });
  expect((await optionsOf(assign.getByLabel('Section'))).sort()).toEqual(['8 8-A', '9 9-A']);
});

test('assigning the same teacher, section and subject again is accepted and keeps a single row', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const assign = page.getByRole('form', { name: 'Assign a teacher' });
  await assign.getByLabel('Teacher').selectOption({ label: `teacher A (${w.teacher.username}, Branch A)` });
  await assign.getByLabel('Section').selectOption({ label: '8 8-A' });
  await assign.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  for (let i = 0; i < 2; i++) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/school/assignments') && r.status() === 201),
      assign.getByRole('button', { name: 'Assign', exact: true }).click(),
    ]);
    await expect(assign.getByRole('status')).toHaveText('Teacher assigned.');
  }
  const rows = await withPlatform((tx) =>
    tx.select().from(teacherAssignments).where(and(
      eq(teacherAssignments.teacherId, w.seed.a.teacherId),
      eq(teacherAssignments.sectionId, w.seed.a.sectionId),
      eq(teacherAssignments.subjectId, w.seed.a.subjectId),
    )),
  );
  expect(rows).toHaveLength(1);
});

test('assignment API: a foreign or wrong-branch teacher or section is refused by role', async () => {
  const admin = await apiAs(w.schoolAdmin);
  const a = w.seed.a;
  await expectErr(
    await admin.post('/api/school/assignments', { data: { teacherId: a.teacherId, sectionId: w.sectionA2, subjectId: a.subjectId } }),
    404,
    'NOT_FOUND',
  );
  await expectErr(
    await admin.post('/api/school/assignments', { data: { teacherId: w.seed.b.teacherId, sectionId: a.sectionId, subjectId: a.subjectId } }),
    404,
    'NOT_FOUND',
  );
  await expectErr(
    await admin.post('/api/school/assignments', { data: { teacherId: 'not-a-uuid', sectionId: a.sectionId, subjectId: a.subjectId } }),
    404,
    'NOT_FOUND',
  );
  const branchAdmin = await apiAs(w.branchAdmin);
  await expectErr(
    await branchAdmin.post('/api/school/assignments', { data: { teacherId: a.teacherId, sectionId: w.sectionA2, subjectId: a.subjectId } }),
    403,
    'FORBIDDEN',
  );
  await expectErr(
    await branchAdmin.post('/api/school/assignments', { data: { teacherId: w.teacherA2Id, sectionId: a.sectionId, subjectId: a.subjectId } }),
    404,
    'NOT_FOUND',
  );
});

test.skip('editing or deleting sections, subjects, teachers and assignments', async () => {
  // Known gap in AS-BUILT-subproject-5.md: creation only. There is no UI or API to edit or delete these, so
  // there is nothing to journey through yet.
});

// ---------- tenant and branch isolation ----------

test('a school admin cannot touch school B through the API', async () => {
  const a = w.seed.a;
  const b = w.seed.b;
  const admin = await apiAs(w.schoolAdmin);
  await expectErr(await admin.post('/api/school/sections', { data: { branchId: b.branchId, grade: 8, name: 'Hijack' } }), 404, 'NOT_FOUND');
  await expectErr(
    await admin.post('/api/school/teachers', { data: { branchId: b.branchId, username: 'hijack.teacher', password: 'hijack-pass-1', name: 'Hijack' } }),
    404,
    'NOT_FOUND',
  );
  await expectErr(await admin.post('/api/school/assignments', { data: { teacherId: b.teacherId, sectionId: b.sectionId, subjectId: b.subjectId } }), 404, 'NOT_FOUND');
  await expectErr(await admin.post('/api/school/assignments', { data: { teacherId: a.teacherId, sectionId: b.sectionId, subjectId: a.subjectId } }), 404, 'NOT_FOUND');
  await expectErr(
    await admin.post('/api/school/students', { data: { branchId: b.branchId, grade: 8, studentName: 'X', parentName: 'P', parentPhone: '9876543210' } }),
    404,
    'NOT_FOUND',
  );
  await expectErr(await admin.post(`/api/school/students/${b.studentId}/remove`), 404, 'NOT_FOUND');
  await expectErr(await admin.post(`/api/school/students/${b.studentId}/password`, { data: { password: 'takeover-pass-1' } }), 404, 'NOT_FOUND');
  await expectErr(await admin.post(`/api/school/students/${b.studentId}/invite`), 404, 'NOT_FOUND');
  await expectErr(await admin.post(`/api/school/branches/${b.branchId}/code`, { data: { action: 'rotate' } }), 404, 'NOT_FOUND');
  await expectErr(await admin.get(`/api/school/enrollment?schoolId=${b.schoolId}`), 403, 'FORBIDDEN');
  await expectErr(await admin.get(`/api/school/students?schoolId=${b.schoolId}`), 403, 'FORBIDDEN');
  await expectErr(await admin.get(`/api/school/students?branchId=${b.branchId}`), 403, 'FORBIDDEN');

  // School B is untouched.
  expect(await currentCode(b.branchId)).toBe(b.code);
  expect(await loginStatus(await credsOf(b.studentId))).toBe(200);
});

test('school A dashboard shows no school B data and refuses a school B branch filter', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await expect(page.getByText('student B')).toHaveCount(0);
  await expect(page.getByText('Branch B', { exact: true })).toHaveCount(0);
  await expect(studentRow(page, 'A2 Student')).toBeVisible();
  await page.goto(`/school?branchId=${w.seed.b.branchId}`);
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
});

test('a branch admin cannot widen scope to another branch, through the API or the page', async ({ page }) => {
  const ba = await apiAs(w.branchAdmin);
  const a2 = w.branchA2.id;
  await expectErr(await ba.get(`/api/school/enrollment?branchId=${a2}`), 403, 'FORBIDDEN');
  await expectErr(await ba.get(`/api/school/students?branchId=${a2}`), 403, 'FORBIDDEN');
  await expectErr(await ba.get(`/api/school/students?schoolId=${w.seed.b.schoolId}`), 403, 'FORBIDDEN');
  await expectErr(
    await ba.post('/api/school/students', { data: { branchId: a2, grade: 9, studentName: 'X', parentName: 'P', parentPhone: '9876543210' } }),
    403,
    'FORBIDDEN',
  );
  await expectErr(await ba.post('/api/school/sections', { data: { branchId: a2, grade: 9, name: '9-Y' } }), 403, 'FORBIDDEN');
  await expectErr(
    await ba.post('/api/school/teachers', { data: { branchId: a2, username: 'a2.intruder', password: 'intruder-pass-1', name: 'Intruder' } }),
    403,
    'FORBIDDEN',
  );
  await expectErr(await ba.post(`/api/school/branches/${a2}/code`, { data: { action: 'rotate' } }), 403, 'FORBIDDEN');
  expect(await currentCode(a2)).toBe(w.branchA2.code);
  await expectErr(await ba.post(`/api/school/students/${w.a2StudentId}/remove`), 403, 'FORBIDDEN');
  await expectErr(await ba.post(`/api/school/students/${w.seed.b.studentId}/remove`), 404, 'NOT_FOUND');

  // Its own branch still works.
  const own = await ba.get(`/api/school/enrollment?branchId=${w.seed.a.branchId}`);
  expect(own.status()).toBe(200);
  const created = await ba.post('/api/school/students', {
    data: { branchId: w.seed.a.branchId, grade: 8, studentName: 'Own Branch Kid', parentName: 'P', parentPhone: '9876543210' },
  });
  expect(created.status()).toBe(201);
  const rotated = await ba.post(`/api/school/branches/${w.seed.a.branchId}/code`, { data: { action: 'rotate' } });
  expect(rotated.status()).toBe(200);
  expect(typeof (await rotated.json()).signupCode).toBe('string');

  // The page is scoped the same way.
  await signIn(page, w.branchAdmin);
  await page.goto(`/school?branchId=${a2}`);
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
});

test('a branch admin sees only their branch on /school and has no subject setup or branch filter', async ({ page }) => {
  await signIn(page, w.branchAdmin);
  await expect(page).toHaveURL(/\/school$/);
  const names = (await rowsOf(studentsTable(page))).map((r) => r[0]).sort();
  expect(names).toEqual(['Asha Rao', 'Removable Kid', 'student A']);
  expect(await rowsOf(card(page, 'Branch by grade').locator('table'))).toHaveLength(2);
  expect((await rowsOf(codesCard(page).locator('table'))).map((r) => r[0])).toEqual(['Branch A']);
  await expect(filterForm(page).getByLabel('Branch')).toHaveCount(0);
  await expect(addStudentForm(page).getByLabel('Branch')).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Add a subject' })).toHaveCount(0);
  await expect(page.getByText('A2 Student')).toHaveCount(0);
});

// ---------- header and role routing ----------

test('the staff header links Home and Log out returns to login, after which /school needs a login', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  const nav = page.getByRole('navigation', { name: 'Account' });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/school');
  await expect(nav.getByRole('link', { name: 'School', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/school$/);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/school');
  await expect(page).toHaveURL(/\/login$/);
});

test('a student and a teacher are sent away from /school, and the API denies both', async ({ page, browser }) => {
  await signIn(page, w.student);
  await expect(page).toHaveURL(/\/status$/);
  await page.goto('/school');
  await expect(page).toHaveURL(/\/status$/);
  await expect(page.getByText('Add a student')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'School', exact: true })).toHaveCount(0);

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const tp = await ctx.newPage();
    await signIn(tp, w.teacher);
    await expect(tp).toHaveURL(/\/teacher$/);
    await tp.goto('/school');
    await expect(tp).toHaveURL(/\/teacher$/);
  } finally {
    await ctx.close();
  }

  const teacherApi = await apiAs(w.teacher);
  await expectErr(await teacherApi.get('/api/school/students'), 403, 'FORBIDDEN');
  await expectErr(await teacherApi.get('/api/school/enrollment'), 403, 'FORBIDDEN');
  const anon = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    expect((await anon.get('/api/school/students')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

// ---------- mobile layout ----------

test('/school has no horizontal page scroll at 390px with a populated table', async ({ page }) => {
  await signIn(page, w.schoolAdmin);
  await expect(studentRow(page, 'A2 Student')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
