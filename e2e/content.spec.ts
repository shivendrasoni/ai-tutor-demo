import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import {
  assignTeacher, createBranch, createSchool, createSection, createStaffUser, createSubject, type Actor,
} from '@/modules/tenancy';
import { resetDb } from '../tests/helpers/db';
import { buildPdf } from '../tests/helpers/pdfs';

test.use({ viewport: { width: 390, height: 844 } });

const PASSWORD = 'e2e-staff-password';
let pdfPath: string;

test.beforeAll(async () => {
  await resetDb();
  const [admin] = await withPlatform((tx) =>
    tx.insert(users).values({ username: 'e2e_platform', name: 'E2E Platform', isPlatformAdmin: true }).returning(),
  );
  const platform: Actor = { userId: admin.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };
  const school = await createSchool(platform, { name: 'Sunrise Public School', board: 'CBSE' });
  const branch = await createBranch(platform, { schoolId: school.id, name: 'Whitefield' });
  const section = await createSection(platform, { branchId: branch.id, grade: 8, name: '8-A' });
  const subject = await createSubject(platform, { schoolId: school.id, name: 'Mathematics' });
  const staff = (role: 'school_admin' | 'branch_admin' | 'teacher', username: string) =>
    createStaffUser(platform, {
      schoolId: school.id, branchId: role === 'school_admin' ? null : branch.id, role,
      username, password: PASSWORD, name: username,
    });
  await staff('school_admin', 'e2e_school_admin');
  await staff('branch_admin', 'e2e_branch_admin');
  const teacher = await staff('teacher', 'e2e_teacher');
  await assignTeacher(platform, { teacherId: teacher.userId, sectionId: section.id, subjectId: subject.id });

  const dir = mkdtempSync(join(tmpdir(), 'e2e-pdf-'));
  pdfPath = join(dir, 'book.pdf');
  writeFileSync(pdfPath, await buildPdf({ pages: ['Fractions are parts of a whole.', 'Decimals extend place value.'] }));
});

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/status$/);
}

test('upload, ingest, hide for branch, teacher material, and role guards', async ({ page }) => {
  // 1. School admin uploads a school-scope book and it becomes Ready (worker runs in-process).
  await login(page, 'e2e_school_admin');
  await page.goto('/school/content');
  await page.getByLabel('Title').fill('E2E Book');
  await page.getByLabel('Kind').selectOption('book');
  await page.getByLabel('Scope').selectOption('school');
  await page.getByLabel('Grade').selectOption('8');
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('PDF file').setInputFiles(pdfPath);
  await page.getByRole('button', { name: 'Upload' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'E2E Book' });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^(Queued|Processing|Ready)$/)).toBeVisible();
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 30_000 });

  // 2. A non-PDF is rejected inline and adds no row.
  await page.getByLabel('Title').fill('Not a PDF');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is plain text, not a pdf'),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('alert').getByText('Only PDF files are accepted.')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);

  // 3. A branch admin hides the school item for their branch, then shows it again.
  await page.request.post('/api/auth/logout');
  await login(page, 'e2e_branch_admin');
  await page.goto('/school/content');
  await page.getByRole('button', { name: 'Hide for this branch' }).click();
  await expect(page.getByRole('button', { name: 'Show for this branch' })).toBeVisible();

  // 4. Teacher uploads a material for the assigned section; cannot open the school page.
  await page.request.post('/api/auth/logout');
  await login(page, 'e2e_teacher');
  await page.goto('/teacher/materials');
  await expect(page.getByLabel('Kind')).toBeDisabled();
  await expect(page.getByLabel('Scope')).toBeDisabled();
  await page.getByLabel('Title').fill('Worksheet 1');
  await page.getByLabel('Branch').selectOption({ label: 'Whitefield' });
  await page.getByLabel('Grade').selectOption('8');
  await page.getByLabel('Section').selectOption({ label: '8-A' });
  await page.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await page.getByLabel('PDF file').setInputFiles(pdfPath);
  await page.getByRole('button', { name: 'Upload' }).click();
  const material = page.getByRole('listitem').filter({ hasText: 'Worksheet 1' });
  await expect(material.getByText('Ready', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto('/school/content');
  await expect(page.getByText('Not allowed')).toBeVisible();

  // 5. Signed out, the page redirects to login.
  await page.request.post('/api/auth/logout');
  await page.goto('/school/content');
  await expect(page).toHaveURL(/\/login$/);
});
