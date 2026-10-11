import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, count } from 'drizzle-orm';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import {
  branches, chunks as chunksTable, contentChapters, contentExclusions, contentItems, memberships, sections,
  studentProfiles, subjects, users,
} from '@/db/schema';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed, type SchoolSeed } from '../../tests/helpers/db';
import { getItemOrNull, seedChunks, seedItem } from '../../tests/helpers/content';
import { activate } from '../../tests/helpers/tutor';
import { buildPdf } from '../../tests/helpers/pdfs';
import { generateBranchCode } from '@/modules/tenancy/codes';

/*
 * Content and curriculum journeys: school admin upload (real NCERT PDFs and fixtures), ingest to ready/failed,
 * retry, branch hide (exclusions), student visibility on /learn/study, teacher materials, cross-school isolation,
 * delete, and the 390px layout. No LLM is used: the in-process worker runs with FakeEmbedder (global-setup).
 *
 * Real curriculum PDFs come from the official NCERT site (ncert.nic.in) and are read from CURRICULUM_DIR
 * (outside the repo). Tests needing them skip with a reason when the file is missing.
 */

const SCRATCH = '/private/tmp/claude-501/-Users-shivendrasoni-Projects-AI-Tutor-for-Schools/12475d63-551d-4236-9c39-ab499588aef3/scratchpad';
const CURRICULUM_DIR = process.env.CURRICULUM_DIR ?? join(SCRATCH, 'curriculum');
const NCERT_MATHS = join(CURRICULUM_DIR, 'ncert-class8-maths-ch1-rational-numbers.pdf');
const NCERT_SCIENCE = join(CURRICULUM_DIR, 'ncert-class8-science-ch1-crop-production.pdf');
const FIXTURE_DIR = join(SCRATCH, 'content-curriculum-fixtures');
const MAX_BYTES = 100 * 1024 * 1024;

const HOME_STAFF = /\/school$/;
const HOME_TEACHER = /\/teacher$/;
const HOME_STUDENT = /\/learn$/;

// ---------- helpers ----------

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function logIn(page: Page, userId: string, home: RegExp) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Username').fill(await usernameOf(userId));
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(home);
}

/** Resets the DB, seeds schools A and B, and activates school A's student (profile only; no payment). */
async function world(): Promise<Seed> {
  await resetDb();
  const seed = await seedTwoSchools();
  await activate(seed.a.student);
  return seed;
}

async function addSubject(school: SchoolSeed, name: string): Promise<string> {
  const [s] = await withPlatform((tx) =>
    tx.insert(subjects).values({ schoolId: school.schoolId, name }).returning({ id: subjects.id }),
  );
  return s.id;
}

/** A second branch in school A with an active grade-8 student (no section, no subscription). */
async function addSecondBranchStudent(seed: Seed): Promise<{ branchId: string; studentId: string }> {
  const [hashRow] = await withPlatform((tx) =>
    tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, seed.a.student.userId!)),
  );
  return withPlatform(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ schoolId: seed.a.schoolId, name: 'Branch Two', signupCode: generateBranchCode() })
      .returning({ id: branches.id });
    const [u] = await tx
      .insert(users)
      .values({ username: `b2_student_${Date.now()}`, name: 'Branch Two Student', passwordHash: hashRow.passwordHash })
      .returning({ id: users.id });
    await tx.insert(memberships).values({ userId: u.id, schoolId: seed.a.schoolId, branchId: b.id, role: 'student' });
    await tx.insert(studentProfiles).values({
      userId: u.id, schoolId: seed.a.schoolId, branchId: b.id, grade: 8, sectionId: null,
      parentName: 'Parent Two', parentPhone: '9999999998', status: 'active',
    });
    return { branchId: b.id, studentId: u.id };
  });
}

type UploadOpts = {
  title: string;
  kind?: 'book' | 'material';
  scope?: 'school' | 'branch' | 'section';
  branchName?: string;
  sectionName?: string;
  grade?: string;
  subjectLabel?: string;
  file: string | { name: string; mimeType: string; buffer: Buffer };
};

/** Fills the UploadForm as the signed-in staff user and submits it. */
async function uploadViaForm(page: Page, o: UploadOpts) {
  await page.getByLabel('Title').fill(o.title);
  if (o.kind) await page.getByLabel('Kind').selectOption(o.kind);
  if (o.scope) await page.getByLabel('Scope').selectOption(o.scope);
  if (o.branchName) await page.getByLabel('Branch').selectOption({ label: o.branchName });
  await page.getByLabel('Grade').selectOption(o.grade ?? '8');
  if (o.sectionName) await page.getByLabel('Section').selectOption({ label: o.sectionName });
  await page.getByLabel('Subject').selectOption({ label: o.subjectLabel ?? 'Mathematics' });
  await page.getByLabel('PDF file').setInputFiles(o.file);
  await page.getByRole('button', { name: 'Upload' }).click();
}

const rowFor = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

async function itemsOf(request: APIRequestContext) {
  const res = await request.get('/api/content');
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    id: string; title: string; status: string; pageCount: number | null; excludedBranchIds: string[];
    ingestError: string | null; scope: string; kind: string;
  }[];
}

async function idByTitle(request: APIRequestContext, title: string): Promise<string> {
  const item = (await itemsOf(request)).find((i) => i.title === title);
  if (!item) throw new Error(`no content item titled ${title}`);
  return item.id;
}

async function chapterCount(itemId: string): Promise<number> {
  const [r] = await withPlatform((tx) =>
    tx.select({ n: count() }).from(contentChapters).where(eq(contentChapters.contentItemId, itemId)),
  );
  return Number(r.n);
}

async function chunkCount(itemId: string): Promise<number> {
  const [r] = await withPlatform((tx) => tx.select({ n: count() }).from(chunksTable).where(eq(chunksTable.contentItemId, itemId)));
  return Number(r.n);
}

async function chapterTitles(itemId: string): Promise<string[]> {
  return withPlatform(async (tx) =>
    (await tx.select({ title: contentChapters.title }).from(contentChapters)
      .where(eq(contentChapters.contentItemId, itemId)).orderBy(contentChapters.ordinal)).map((r) => r.title),
  );
}

/** Opens the study hub create form as a student and returns the subject names and chapter labels offered. */
async function studentPicker(page: Page, subjectName: string) {
  await page.goto('/learn/study');
  const subjectsLoaded = page.waitForResponse((r) => r.url().includes('/api/tutor/subjects') && r.ok());
  await page.getByRole('button', { name: 'Create' }).click();
  await subjectsLoaded;
  const subjectOptions = (await page.getByLabel('Subject').locator('option').allTextContents()).map((s) => s.trim());
  if (!subjectOptions.includes(subjectName)) return { subjectOptions, chapters: [] as string[] };
  const chaptersLoaded = page.waitForResponse((r) => r.url().includes('/api/study/chapters') && r.ok());
  await page.getByLabel('Subject').selectOption({ label: subjectName });
  await chaptersLoaded;
  const chapters = (await page.locator('fieldset label').allTextContents()).map((s) => s.trim());
  return { subjectOptions, chapters };
}

/** A minimal PDF-looking buffer that parses as a PDF header but has no usable structure. */
const corruptPdf = () => Buffer.from(`%PDF-1.4\n${'garbage stream data '.repeat(40)}\n%%EOF`);

const pdfFixture = async (pages: string[]): Promise<Buffer> => Buffer.from(await buildPdf({ pages }));

test.describe('content and curriculum journeys', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(180_000);

  // 1. Real NCERT upload, admin, through ingest to ready
  test('school admin uploads an NCERT Class 8 Maths chapter; it moves to Ready with metadata and chapters', async ({ page, request }) => {
    test.skip(!existsSync(NCERT_MATHS), `missing ${NCERT_MATHS}`);
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    await expect(page.getByText('Nothing uploaded yet.')).toBeVisible();

    const title = 'NCERT Class 8 Maths: Rational Numbers';
    await uploadViaForm(page, { title, scope: 'school', kind: 'book', grade: '8', subjectLabel: 'Mathematics', file: NCERT_MATHS });
    await expect(page.getByRole('status').getByText('Uploaded. Processing will start shortly.')).toBeVisible();

    const row = rowFor(page, title);
    await expect(row).toBeVisible();
    await expect(row.getByText(/^(Queued|Processing|Ready)$/)).toBeVisible();
    await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText('Book · Mathematics · Grade 8 · Whole school');
    // Reload shows the same persisted state.
    await page.reload();
    await expect(rowFor(page, title).getByText('Ready', { exact: true })).toBeVisible();

    const id = await idByTitle(page.request, title);
    const api = (await itemsOf(page.request)).find((i) => i.id === id)!;
    expect(api.status).toBe('ready');
    expect(api.pageCount).toBeGreaterThan(0);
    expect(await chunkCount(id)).toBeGreaterThan(0);
    expect(await chapterCount(id)).toBeGreaterThan(0);
    expect((await chapterTitles(id)).length).toBeGreaterThan(0);
  });

  test('school admin uploads an NCERT Class 8 Science chapter for one branch; branch scope shows in metadata', async ({ page, request }) => {
    test.skip(!existsSync(NCERT_SCIENCE), `missing ${NCERT_SCIENCE}`);
    const seed = await world();
    await addSubject(seed.a, 'Science');
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const title = 'NCERT Class 8 Science: Crop Production';
    await uploadViaForm(page, {
      title, scope: 'branch', branchName: 'Branch A', kind: 'book', grade: '8', subjectLabel: 'Science', file: NCERT_SCIENCE,
    });
    const row = rowFor(page, title);
    await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText('Book · Science · Grade 8 · Branch');
    const id = await idByTitle(page.request, title);
    expect(await chapterCount(id)).toBeGreaterThan(0);
  });

  test('two identical uploads are both accepted and both reach Ready (no silent dedupe)', async ({ page, request }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const path = await fixtureFile('dup.pdf', ['Fractions are parts of a whole.', 'Decimals extend place value.']);
    for (let i = 1; i <= 2; i++) {
      await uploadViaForm(page, { title: 'Duplicate Worksheet', scope: 'school', kind: 'material', grade: '8', file: path });
      await expect(page.getByRole('status').getByText('Uploaded. Processing will start shortly.')).toBeVisible();
      await expect(page.getByRole('listitem').filter({ hasText: 'Duplicate Worksheet' })).toHaveCount(i, { timeout: 15_000 });
    }
    await expect(page.getByRole('listitem').filter({ hasText: 'Duplicate Worksheet' }).getByText('Ready', { exact: true })).toHaveCount(2, { timeout: 90_000 });
    const items = (await itemsOf(page.request)).filter((i) => i.title === 'Duplicate Worksheet');
    expect(items).toHaveLength(2);
  });

  // 2. Upload validation
  test('a non-PDF file is rejected with a clear message and adds no row', async ({ page, request }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    await uploadViaForm(page, {
      title: 'Not A PDF', scope: 'school', kind: 'book', grade: '8',
      file: { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('plain text, not a pdf') },
    });
    await expect(page.getByRole('alert').getByText('Only PDF files are accepted.')).toBeVisible();
    await expect(page.getByText('Nothing uploaded yet.')).toBeVisible();
    expect(await itemsOf(page.request)).toHaveLength(0);
  });

  test('an empty file is rejected and adds no row', async ({ page, request }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    await uploadViaForm(page, {
      title: 'Empty File', scope: 'school', kind: 'book', grade: '8',
      file: { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
    });
    // Observed: an empty file gets the same "Only PDF files" message as a non-PDF (no separate "empty" message).
    await expect(page.getByRole('alert').getByText('Only PDF files are accepted.')).toBeVisible();
    expect(await itemsOf(page.request)).toHaveLength(0);
  });

  test('a file over 100 MB is refused in the browser before any upload request is sent', async ({ page, request }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const big = join(FIXTURE_DIR, 'oversize.pdf');
    const buf = Buffer.alloc(MAX_BYTES + 1);
    buf.write('%PDF-1.4\n', 0, 'latin1');
    writeFileSync(big, buf);
    let posted = false;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/content')) posted = true; });
    await uploadViaForm(page, { title: 'Too Big', scope: 'school', kind: 'book', grade: '8', file: big });
    await expect(page.getByRole('alert').getByText('That file is too large (max 100 MB).')).toBeVisible();
    expect(posted).toBe(false);
    expect(await itemsOf(page.request)).toHaveLength(0);
  });

  test('the server refuses an over-limit upload that bypasses the browser check (400, reason too_large)', async ({ request, page }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    const res = await page.request.post('/api/content', {
      multipart: {
        file: { name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(MAX_BYTES + 1, 0x20) },
        title: 'Huge', kind: 'book', scope: 'school', grade: '8', subjectId: seed.a.subjectId,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details.reason).toBe('too_large');
    expect(await itemsOf(page.request)).toHaveLength(0);
    void request;
  });

  // 3. Failure path and retry
  test('a corrupt PDF goes to Failed with an error; after the file is fixed, Retry brings it to Ready', async ({ page, request }) => {
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const bad = join(FIXTURE_DIR, 'corrupt.pdf');
    writeFileSync(bad, corruptPdf());
    const title = 'Corrupt Book';
    await uploadViaForm(page, { title, scope: 'school', kind: 'book', grade: '8', file: bad });
    const row = rowFor(page, title);
    await expect(row.getByText('Failed', { exact: true })).toBeVisible({ timeout: 150_000 });
    await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible();
    const id = await idByTitle(page.request, title);
    const dbRow = await getItemOrNull(id);
    expect(dbRow?.ingestStatus).toBe('failed');
    expect(dbRow?.ingestError?.length ?? 0).toBeGreaterThan(0);
    await expect(row.getByText(dbRow!.ingestError!.slice(0, 40), { exact: false })).toBeVisible();

    // Fix the stored file (test environment only), then retry.
    const blobDir = process.env.BLOB_DIR!;
    writeFileSync(join(blobDir, dbRow!.fileKey), await pdfFixture(['Fractions are parts of a whole.', 'Decimals extend place value.']));
    await row.getByRole('button', { name: 'Retry' }).click();
    await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 120_000 });
    expect((await getItemOrNull(id))?.ingestStatus).toBe('ready');
    expect(await chunkCount(id)).toBeGreaterThan(0);
  });

  test('retry API refuses ready items (400), unknown ids (404), and anonymous callers (401)', async ({ page, request }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { ingestStatus: 'ready', title: 'Ready Already' });
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    const ready = await page.request.post(`/api/content/${item.id}/retry`, { data: {} });
    expect(ready.status()).toBe(400);
    expect((await ready.json()).error.code).toBe('VALIDATION');
    const missing = await page.request.post(`/api/content/${crypto.randomUUID()}/retry`, { data: {} });
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
    const malformed = await page.request.post('/api/content/not-a-uuid/retry', { data: {} });
    expect(malformed.status()).toBe(404);
    const anon = await request.post(`/api/content/${item.id}/retry`, { data: {} });
    expect(anon.status()).toBe(401);
    expect((await anon.json()).error.code).toBe('UNAUTHENTICATED');
  });

  // 4. Exclusions (branch hide) and student visibility
  test('branch admin hides a school book for their branch: student of that branch loses it, other branch keeps it, admin still sees it', async ({ page, request, browser }) => {
    const seed = await world();
    const other = await addSecondBranchStudent(seed);
    const item = await seedItem(seed.a, { title: 'Shared Maths Book', ingestStatus: 'ready', scope: 'school', grade: 8 });
    await seedChunks(item.id, [{ title: 'Chapter 1 Rational Numbers', texts: ['Rational numbers are numbers of the form p/q.'] }]);

    // Branch admin hides it.
    await logIn(page, seed.a.branchAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const brow = rowFor(page, 'Shared Maths Book');
    await brow.getByRole('button', { name: 'Hide for this branch' }).click();
    await expect(brow.getByRole('button', { name: 'Show for this branch' })).toBeVisible();
    const branchView = (await itemsOf(page.request)).find((i) => i.id === item.id)!;
    expect(branchView.excludedBranchIds).toContain(seed.a.branchId);

    // Student of the hidden branch no longer sees the chapter; the subject is gone entirely.
    await logIn(page, seed.a.student.userId!, HOME_STUDENT);
    const hidden = await studentPicker(page, 'Mathematics');
    expect(hidden.subjectOptions).not.toContain('Mathematics');
    expect(hidden.chapters).toEqual([]);

    // Student of the other branch still sees it.
    await logIn(page, other.studentId, HOME_STUDENT);
    const shown = await studentPicker(page, 'Mathematics');
    expect(shown.chapters).toEqual(['Chapter 1 Rational Numbers']);

    // School admin: no hide control and the item is still listed.
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const arow = rowFor(page, 'Shared Maths Book');
    await expect(arow).toBeVisible();
    await expect(arow.getByRole('button', { name: /Hide for this branch|Show for this branch/ })).toHaveCount(0);

    // Branch admin shows it again: the hidden student sees the chapter again.
    await logIn(page, seed.a.branchAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    await rowFor(page, 'Shared Maths Book').getByRole('button', { name: 'Show for this branch' }).click();
    await expect(rowFor(page, 'Shared Maths Book').getByRole('button', { name: 'Hide for this branch' })).toBeVisible();
    await logIn(page, seed.a.student.userId!, HOME_STUDENT);
    const restored = await studentPicker(page, 'Mathematics');
    expect(restored.chapters).toEqual(['Chapter 1 Rational Numbers']);
    void browser;
  });

  test('student sees only ready, grade-matched, non-hidden chapters; pending and other-grade items stay out', async ({ page, request }) => {
    const seed = await world();
    const ready = await seedItem(seed.a, { title: 'Ready Maths Book', ingestStatus: 'ready', grade: 8 });
    await seedChunks(ready.id, [{ title: 'Visible Chapter', texts: ['Visible chapter text about fractions.'] }]);
    const pending = await seedItem(seed.a, { title: 'Pending Maths Book', ingestStatus: 'queued', grade: 8 });
    await seedChunks(pending.id, [{ title: 'Pending Chapter', texts: ['Pending text not yet ready.'] }]);
    const nineth = await seedItem(seed.a, { title: 'Grade Nine Book', ingestStatus: 'ready', grade: 9 });
    await seedChunks(nineth.id, [{ title: 'Grade Nine Chapter', texts: ['Grade nine material.'] }]);

    await logIn(page, seed.a.student.userId!, HOME_STUDENT);
    const picker = await studentPicker(page, 'Mathematics');
    expect(picker.chapters).toEqual(['Visible Chapter']);

    const res = await page.request.get(`/api/study/chapters?subjectId=${seed.a.subjectId}`);
    expect(res.status()).toBe(200);
    const apiChapters = (await res.json()) as { title: string }[];
    expect(apiChapters.map((c) => c.title)).toEqual(['Visible Chapter']);

    // A subject id from school B yields nothing for school A's student.
    const cross = await page.request.get(`/api/study/chapters?subjectId=${seed.b.subjectId}`);
    expect(cross.status()).toBe(200);
    expect(await cross.json()).toEqual([]);

    // Missing or malformed subjectId is a validation error.
    const bad = await page.request.get('/api/study/chapters?subjectId=nope');
    expect(bad.status()).toBe(400);
    void request;
  });

  test('the NCERT chapter that finished ingesting shows up in the student chapter picker', async ({ page }) => {
    test.skip(!existsSync(NCERT_MATHS), `missing ${NCERT_MATHS}`);
    const seed = await world();
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const title = 'NCERT Maths for Students';
    await uploadViaForm(page, { title, scope: 'school', kind: 'book', grade: '8', subjectLabel: 'Mathematics', file: NCERT_MATHS });
    await expect(rowFor(page, title).getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
    const itemId = (await itemsOf(page.request)).find((i) => i.title === title)!.id;
    const expected = await chapterTitles(itemId);

    await logIn(page, seed.a.student.userId!, HOME_STUDENT);
    const picker = await studentPicker(page, 'Mathematics');
    expect(picker.chapters.length).toBeGreaterThan(0);
    for (const t of picker.chapters) expect(expected).toContain(t);
  });

  // 5. Teacher journey
  test('teacher uploads a section material for an assigned section and sees it under Your materials', async ({ page }) => {
    const seed = await world();
    await logIn(page, seed.a.teacher.userId!, HOME_TEACHER);
    await page.goto('/teacher/materials');
    await expect(page.getByLabel('Kind')).toBeDisabled();
    await expect(page.getByLabel('Scope')).toBeDisabled();
    await expect(page.getByLabel('Scope')).toHaveValue('section');
    await expect(page.getByLabel('Section').locator('option')).toHaveText(['Select a section', '8-A']);

    const title = 'Worksheet 1';
    await uploadViaForm(page, { title, grade: '8', sectionName: '8-A', subjectLabel: 'Mathematics', file: await fixtureFile('worksheet.pdf', ['Fractions worksheet.']) });
    await expect(page.getByRole('status').getByText('Uploaded. Processing will start shortly.')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(row).toContainText('Material · Mathematics · Grade 8 · Section');
  });

  test('teacher cannot upload to another school, an unassigned section, a book, or school-wide scope (403 each)', async ({ page }) => {
    const seed = await world();
    await logIn(page, seed.a.teacher.userId!, HOME_TEACHER);
    // Unassigned section in the teacher's own branch.
    const [unassigned] = await withPlatform((tx) =>
      tx.insert(sections).values({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, grade: 8, name: '8-B' }).returning({ id: sections.id }),
    );
    const pdf = { name: 'x.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(['x']) };
    const post = (fields: Record<string, string>) =>
      page.request.post('/api/content', {
        multipart: { file: pdf, title: 'Attempt', grade: '8', branchId: seed.a.branchId, ...fields },
      });

    const otherSchool = await post({ schoolId: seed.b.schoolId, kind: 'material', scope: 'section', sectionId: seed.b.sectionId, subjectId: seed.b.subjectId });
    expect(otherSchool.status()).toBe(403);
    expect((await otherSchool.json()).error.code).toBe('FORBIDDEN');

    const unassignedRes = await post({ kind: 'material', scope: 'section', sectionId: unassigned.id, subjectId: seed.a.subjectId });
    expect(unassignedRes.status()).toBe(403);
    expect((await unassignedRes.json()).error.code).toBe('FORBIDDEN');

    const book = await post({ kind: 'book', scope: 'section', sectionId: seed.a.sectionId, subjectId: seed.a.subjectId });
    expect(book.status()).toBe(403);

    const school = await post({ kind: 'book', scope: 'school', subjectId: seed.a.subjectId });
    expect(school.status()).toBe(403);
    expect(await itemsOf(page.request)).toEqual([]);
  });

  test('teacher is turned away from the school content page', async ({ page }) => {
    const seed = await world();
    await logIn(page, seed.a.teacher.userId!, HOME_TEACHER);
    await page.goto('/school/content');
    await expect(page.getByText('Not allowed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  });

  test('students cannot list, upload or retry content, and the school page shows Not allowed', async ({ page, request }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { ingestStatus: 'failed' });
    await logIn(page, seed.a.student.userId!, HOME_STUDENT);
    const list = await page.request.get('/api/content');
    expect(list.status()).toBe(403);
    expect((await list.json()).error.code).toBe('FORBIDDEN');
    const up = await page.request.post('/api/content', {
      multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(['a']) }, title: 'S', kind: 'book', scope: 'school', grade: '8', subjectId: seed.a.subjectId },
    });
    expect(up.status()).toBe(403);
    const retry = await page.request.post(`/api/content/${item.id}/retry`, { data: {} });
    expect(retry.status()).toBe(403);
    await page.goto('/school/content');
    await expect(page.getByText('Not allowed')).toBeVisible();
    void request;
  });

  // 6. Cross-school isolation
  test('school A staff get 404 for school B content (delete, retry, exclusions) and never see it listed', async ({ page }) => {
    const seed = await world();
    const bItem = await seedItem(seed.b, { title: 'School B Private Book', ingestStatus: 'failed' });
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);

    const del = await page.request.delete(`/api/content/${bItem.id}`);
    expect(del.status()).toBe(404);
    expect((await del.json()).error.code).toBe('NOT_FOUND');

    const retry = await page.request.post(`/api/content/${bItem.id}/retry`, { data: {} });
    expect(retry.status()).toBe(404);

    const exA = await page.request.post('/api/content/exclusions', { data: { branchId: seed.a.branchId, contentItemId: bItem.id, excluded: true } });
    expect(exA.status()).toBe(404);
    const exB = await page.request.post('/api/content/exclusions', { data: { branchId: seed.b.branchId, contentItemId: bItem.id, excluded: true } });
    expect(exB.status()).toBe(404);

    // Nothing was changed on school B's item.
    expect(await getItemOrNull(bItem.id)).not.toBeNull();
    const [ex] = await withPlatform((tx) => tx.select({ n: count() }).from(contentExclusions).where(eq(contentExclusions.contentItemId, bItem.id)));
    expect(Number(ex.n)).toBe(0);

    const list = await itemsOf(page.request);
    expect(list.find((i) => i.id === bItem.id)).toBeUndefined();
    await page.goto('/school/content');
    await expect(page.getByText('School B Private Book')).toHaveCount(0);

    // Filtering the list by school B's branch returns nothing from B.
    const byBranch = await page.request.get(`/api/content?branchId=${seed.b.branchId}`);
    expect(byBranch.status()).toBe(200);
    expect(await byBranch.json()).toEqual([]);

    // Spec mentions GET /api/content/[id]; the route only exports DELETE, so GET is refused by the framework.
    const get = await page.request.get(`/api/content/${bItem.id}`);
    expect([404, 405]).toContain(get.status());
  });

  test('a school B admin cannot read or change school A content through the API', async ({ page }) => {
    const seed = await world();
    const aItem = await seedItem(seed.a, { title: 'School A Book', ingestStatus: 'failed' });
    await logIn(page, seed.b.schoolAdmin.userId!, HOME_STAFF);
    const del = await page.request.delete(`/api/content/${aItem.id}`);
    expect(del.status()).toBe(404);
    const retry = await page.request.post(`/api/content/${aItem.id}/retry`, { data: {} });
    expect(retry.status()).toBe(404);
    const ex = await page.request.post('/api/content/exclusions', { data: { branchId: seed.b.branchId, contentItemId: aItem.id, excluded: true } });
    expect(ex.status()).toBe(404);
    expect(await getItemOrNull(aItem.id)).not.toBeNull();
    expect(await itemsOf(page.request)).toHaveLength(0);
  });

  test('exclusions API validates its body (400) and requires a signed-in staff user (401)', async ({ page, request }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { ingestStatus: 'ready' });
    const anon = await request.post('/api/content/exclusions', { data: { branchId: seed.a.branchId, contentItemId: item.id, excluded: true } });
    expect(anon.status()).toBe(401);
    await logIn(page, seed.a.branchAdmin.userId!, HOME_STAFF);
    const bad = await page.request.post('/api/content/exclusions', { data: { branchId: 'nope', contentItemId: item.id, excluded: true } });
    expect(bad.status()).toBe(400);
    const notBranch = await page.request.post('/api/content/exclusions', { data: { branchId: seed.b.branchId, contentItemId: item.id, excluded: true } });
    expect(notBranch.status()).toBe(400);
    expect((await notBranch.json()).error.code).toBe('VALIDATION');
  });

  // 7. Delete
  test('school admin deletes an item from the list after confirming; the row and its record go', async ({ page }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { title: 'Old Worksheet', ingestStatus: 'ready' });
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    const row = rowFor(page, 'Old Worksheet');
    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Old Worksheet' })).toHaveCount(0);
    await expect(page.getByText('Nothing uploaded yet.')).toBeVisible();
    expect(await getItemOrNull(item.id)).toBeNull();
  });

  test('cancelling the delete confirmation keeps the row', async ({ page }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { title: 'Keep Me', ingestStatus: 'ready' });
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    page.once('dialog', (d) => void d.dismiss());
    await rowFor(page, 'Keep Me').getByRole('button', { name: 'Delete' }).click();
    await expect(rowFor(page, 'Keep Me')).toBeVisible();
    expect(await getItemOrNull(item.id)).not.toBeNull();
  });

  test('branch admin cannot delete a school-wide item (403 surfaced in the list)', async ({ page }) => {
    const seed = await world();
    const item = await seedItem(seed.a, { title: 'School Wide Book', ingestStatus: 'ready', scope: 'school' });
    await logIn(page, seed.a.branchAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    page.once('dialog', (d) => void d.accept());
    await rowFor(page, 'School Wide Book').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alert').getByText('Could not delete. Please try again.')).toBeVisible();
    await expect(rowFor(page, 'School Wide Book')).toBeVisible();
    expect(await getItemOrNull(item.id)).not.toBeNull();
  });

  // 8. Layout
  test('school content page at 390px has no horizontal scroll with a long title and several items', async ({ page }) => {
    const seed = await world();
    const long = 'Unusually long curriculum book title that keeps going to test wrapping on phones '.repeat(2).trim().slice(0, 200);
    await seedItem(seed.a, { title: long, ingestStatus: 'ready' });
    await seedItem(seed.a, { title: 'Second Book', ingestStatus: 'failed', ingestError: 'Could not parse the PDF structure at all' });
    await logIn(page, seed.a.schoolAdmin.userId!, HOME_STAFF);
    await page.goto('/school/content');
    await expect(page.getByRole('listitem')).toHaveCount(2);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    expect(await page.getByLabel('Title').isVisible()).toBe(true);
  });

});

/** Writes a small PDF fixture under the scratchpad and returns its path. */
async function fixtureFile(name: string, pages: string[]): Promise<string> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, await pdfFixture(pages));
  return path;
}
