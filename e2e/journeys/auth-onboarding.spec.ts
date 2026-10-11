import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { invites, plans, studentProfiles, subscriptions, users } from '@/db/schema';
import { manualAddStudent, removeStudent, signupWithCode } from '@/modules/enrollment';
import { setBranchCodeEnabled, type Actor } from '@/modules/tenancy';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';
import { login, type Creds } from '../helpers/seed';

test.use({ viewport: { width: 390, height: 844 } });

// No closeDb(): Playwright reuses one worker process across spec files, and the db pools are module-level.

const PENDING_COPY =
  "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.";
const SUCCESS_COPY = "Account created. You'll be able to log in once your payment is confirmed.";
const INVITE_UNAVAILABLE_COPY = 'This invite link has expired or was already used. Ask your school for a new one.';
const TAKEN_COPY = 'That username is taken. Pick another or choose one of the suggestions.';

type World = {
  seed: Seed;
  schoolName: string;
  branchName: string;
  code: string;
  schoolAdmin: Creds;
  branchAdmin: Creds;
  teacher: Creds;
  platform: Creds;
  pendingStudent: Creds;
  pendingStudentId: string;
};

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

/** Fresh DB with two schools; every seeded user logs in with SEED_PASSWORD. */
async function freshWorld(): Promise<World> {
  await resetDb();
  const seed = await seedTwoSchools();
  const c = async (userId: string): Promise<Creds> => ({ username: await usernameOf(userId), password: SEED_PASSWORD });
  return {
    seed,
    schoolName: 'School A',
    branchName: 'Branch A',
    code: seed.a.code,
    schoolAdmin: await c(seed.a.schoolAdmin.userId!),
    branchAdmin: await c(seed.a.branchAdmin.userId!),
    teacher: await c(seed.a.teacher.userId!),
    platform: await c(seed.platform.userId!),
    pendingStudent: await c(seed.a.studentId),
    pendingStudentId: seed.a.studentId,
  };
}

/** The signed-up student row for a username (null when none). */
async function signupRow(username: string) {
  const [row] = await withPlatform((tx) =>
    tx
      .select({
        userId: users.id,
        profileStatus: studentProfiles.status,
        grade: studentProfiles.grade,
        sectionId: studentProfiles.sectionId,
        parentEmail: studentProfiles.parentEmail,
        subStatus: subscriptions.status,
        planName: plans.name,
      })
      .from(users)
      .innerJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .innerJoin(subscriptions, eq(subscriptions.studentId, users.id))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(users.username, username)),
  );
  return row ?? null;
}

async function userCount(username: string): Promise<number> {
  const rows = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.username, username)));
  return rows.length;
}

async function expectApiError(res: APIResponse, status: number, code: string) {
  expect(res.status()).toBe(status);
  const body = await res.json();
  expect(body.error?.code).toBe(code);
  expect(typeof body.error?.message).toBe('string');
}

/** Opens the public join flow and gets past the code step to the signup form for School A / Branch A. */
async function joinFormFor(page: Page, code: string) {
  await page.goto('/join');
  await page.getByLabel('Signup code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Joining School A — Branch A')).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------
// Public join (/join)
// ---------------------------------------------------------------------------------------------------------------

test.describe('public join', () => {
  test('J1 valid branch-code signup creates a pending account, and the student lands on the pending status page', async ({ page }) => {
    const w = await freshWorld();
    await joinFormFor(page, w.code);

    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Section (optional)').selectOption({ label: '8-A' });
    await page.getByLabel('Student name').fill('Journey Kid');
    await page.getByLabel('Parent name').fill('Journey Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel('Parent email (optional)').fill('parent@example.com');
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('Journey.Kid');
    await page.getByLabel('Password').fill('journey-kid-pass');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('status')).toHaveText(SUCCESS_COPY);
    await expect(page.getByRole('link', { name: 'Go to log in' })).toBeVisible();

    // The stored row: username normalised, pending_payment profile, pending subscription on the chosen plan.
    const row = await signupRow('journey.kid');
    expect(row).toMatchObject({
      profileStatus: 'pending_payment',
      grade: 8,
      parentEmail: 'parent@example.com',
      subStatus: 'pending',
      planName: 'Monthly',
    });
    expect(row!.sectionId).not.toBeNull();

    // Log in with the mixed-case username: the pending student is sent to /status, not /learn.
    await login(page, { username: 'JOURNEY.KID', password: 'journey-kid-pass' });
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText(PENDING_COPY)).toBeVisible();

    const me = await page.request.get('/api/me/status');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ status: 'pending_payment', planName: 'Monthly', periodEnd: null });
  });

  test('J2 an unknown signup code stays on the code step with the friendly error', async ({ page, request }) => {
    await freshWorld();
    await page.goto('/join');
    await page.getByLabel('Signup code').fill('ZZZZZZZZ');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText("That signup code isn't valid. Check it and try again.");
    await expect(page.getByLabel('Signup code')).toBeVisible();
    await expect(page.getByLabel('Student name')).toHaveCount(0);

    await expectApiError(await request.get('/api/join/code/ZZZZZZZZ'), 404, 'INVALID_CODE');
  });

  test('J3 a code whose signups are turned off shows the disabled message and the API returns 410', async ({ page, request }) => {
    const w = await freshWorld();
    await setBranchCodeEnabled(w.seed.a.schoolAdmin, w.seed.a.branchId, false);

    await page.goto('/join');
    await page.getByLabel('Signup code').fill(w.code);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Signups with this code are turned off. Ask your school.');
    await expect(page.getByLabel('Student name')).toHaveCount(0);

    await expectApiError(await request.get(`/api/join/code/${w.code}`), 410, 'CODE_DISABLED');
  });

  test('J4 a valid code returns the branch and its sections for the form', async ({ request }) => {
    const w = await freshWorld();
    const res = await request.get(`/api/join/code/${w.code}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ schoolName: 'School A', branchName: 'Branch A' });
    expect(body.sections).toEqual([expect.objectContaining({ grade: 8, name: '8-A' })]);
  });

  test('J5 section choices follow the chosen grade and section is optional', async ({ page }) => {
    const w = await freshWorld();
    await joinFormFor(page, w.code);

    // No section exists for grade 5, so the section picker is disabled.
    await page.getByLabel('Grade').selectOption('5');
    await expect(page.getByLabel('Section (optional)')).toBeDisabled();

    // Grade 8 offers 8-A; leaving "Not sure / none" signs up without a section.
    await page.getByLabel('Grade').selectOption('8');
    await expect(page.getByLabel('Section (optional)')).toBeEnabled();
    await page.getByLabel('Section (optional)').selectOption({ label: '8-A' });
    await page.getByLabel('Section (optional)').selectOption({ label: 'Not sure / none' });

    await page.getByLabel('Student name').fill('No Section Kid');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('nosection.kid');
    await page.getByLabel('Password').fill('nosection-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toHaveText(SUCCESS_COPY);

    const row = await signupRow('nosection.kid');
    expect(row?.sectionId).toBeNull();
    expect(row?.parentEmail).toBeNull();
  });

  test('J6 required fields: Create account stays disabled until a plan is chosen, and native validation blocks an empty name', async ({ page }) => {
    const w = await freshWorld();
    let joinPosts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/join')) joinPosts++;
    });
    await joinFormFor(page, w.code);

    const submit = page.getByRole('button', { name: 'Create account' });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();
    await expect(submit).toBeEnabled();

    // Student name is empty: the browser's required check stops the submit before any request.
    await submit.click();
    const nameValid = await page.getByLabel('Student name').evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(nameValid).toBe(false);
    expect(joinPosts).toBe(0);
    await expect(page.getByText(SUCCESS_COPY)).toHaveCount(0);
  });

  test('J7 a weak password is rejected by the server with a readable message and creates no account', async ({ page, request }) => {
    const w = await freshWorld();
    await joinFormFor(page, w.code);
    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Student name').fill('Weak Pass Kid');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('weakpass.kid');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('p[role="alert"]')).toHaveText('Password must be 8-128 characters');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(await userCount('weakpass.kid')).toBe(0);

    // Same rule on the API.
    const res = await request.post('/api/join', {
      data: {
        code: w.code, grade: 8, studentName: 'X', parentName: 'Y', parentPhone: '1', planId: w.seed.planId,
        username: 'weakpass.api', password: 'short',
      },
    });
    await expectApiError(res, 400, 'WEAK_PASSWORD');
  });

  test('J8 an invalid username is rejected: the blur check keeps the rules hint and submit shows the server message', async ({ page }) => {
    const w = await freshWorld();
    await joinFormFor(page, w.code);
    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Student name').fill('Bad Name Kid');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('ab');
    await page.getByLabel('Username').blur();
    await expect(page.getByText('Letters, numbers, _ or . (4–32 characters). Not case-sensitive.')).toBeVisible();
    await page.getByLabel('Password').fill('valid-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('Username must be 4-32 characters');
    expect(await userCount('ab')).toBe(0);
  });

  test('J9 username availability: a taken name shows suggestions, a suggestion becomes available, and the signup completes', async ({ page }) => {
    const w = await freshWorld();
    // The seeded student already owns this username.
    const taken = w.pendingStudent.username;

    await joinFormFor(page, w.code);
    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Student name').fill('Dup Kid');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();

    await page.getByLabel('Username').fill(taken);
    await page.getByLabel('Username').blur();
    await expect(page.getByRole('status').filter({ hasText: `${taken} is taken.` })).toBeVisible();
    const chip = page.getByRole('button', { name: new RegExp(`^${taken}\\d+$`) }).first();
    await expect(chip).toBeVisible();
    const chipName = (await chip.textContent())!.trim();

    await chip.click();
    await expect(page.getByLabel('Username')).toHaveValue(chipName);
    await expect(page.getByRole('status').filter({ hasText: `${chipName} is available.` })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${taken}\\d+$`) })).toHaveCount(0);

    await page.getByLabel('Password').fill('dup-kid-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toHaveText(SUCCESS_COPY);
    expect(await userCount(chipName)).toBe(1);
  });

  test('J10 submitting a taken username without the blur check returns the taken message and suggestions', async ({ page, request }) => {
    const w = await freshWorld();
    const taken = w.pendingStudent.username;
    await joinFormFor(page, w.code);
    await page.getByLabel('Grade').selectOption('8');
    await page.getByLabel('Student name').fill('Race Kid');
    await page.getByLabel('Parent name').fill('Parent');
    await page.getByLabel('Parent phone').fill('9876543210');
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill(taken);
    await page.getByLabel('Password').fill('race-kid-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('p[role="alert"]')).toHaveText(TAKEN_COPY);
    await expect(page.getByRole('button', { name: new RegExp(`^${taken}\\d+$`) }).first()).toBeVisible();

    // API: availability endpoint and the submit both report the taken name with suggestions.
    const avail = await request.get(`/api/join/username?u=${taken}`);
    expect(avail.status()).toBe(200);
    const availBody = await avail.json();
    expect(availBody).toMatchObject({ username: taken, available: false });
    expect(availBody.suggestions).toHaveLength(3);

    const submit = await request.post('/api/join', {
      data: {
        code: w.code, grade: 8, studentName: 'Race Kid', parentName: 'Parent', parentPhone: '1',
        planId: w.seed.planId, username: taken, password: 'race-kid-pass-1',
      },
    });
    await expectApiError(submit, 409, 'USERNAME_TAKEN');
    const body = await submit.json();
    expect(body.error.details.suggestions).toHaveLength(3);
  });

  test('J11 join API envelopes: username check states, validation errors and unknown plans', async ({ request }) => {
    const w = await freshWorld();

    const ok = await request.get('/api/join/username?u=Fresh.Name');
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ username: 'fresh.name', available: true, suggestions: [] });

    await expectApiError(await request.get('/api/join/username?u=ab'), 400, 'INVALID_USERNAME');
    await expectApiError(await request.get('/api/join/username'), 400, 'VALIDATION');

    // Wrong grade and a non-uuid plan are validation errors, not server errors.
    await expectApiError(
      await request.post('/api/join', {
        data: { code: w.code, grade: 4, studentName: 'A', parentName: 'B', parentPhone: '1', planId: w.seed.planId, username: 'grade.four', password: 'valid-pass-1' },
      }),
      400,
      'VALIDATION',
    );
    await expectApiError(
      await request.post('/api/join', {
        data: { code: w.code, grade: 8, studentName: 'A', parentName: 'B', parentPhone: '1', planId: 'not-a-uuid', username: 'bad.plan', password: 'valid-pass-1' },
      }),
      400,
      'VALIDATION',
    );
    // A well-formed plan id that is not in the catalogue.
    await expectApiError(
      await request.post('/api/join', {
        data: { code: w.code, grade: 8, studentName: 'A', parentName: 'B', parentPhone: '1', planId: '00000000-0000-4000-8000-000000000000', username: 'ghost.plan', password: 'valid-pass-1' },
      }),
      400,
      'VALIDATION',
    );
    // Wrong content type is refused before the body is read.
    await expectApiError(
      await request.post('/api/join', { headers: { 'content-type': 'text/plain' }, data: 'hello' }),
      400,
      'VALIDATION',
    );
    // Unknown branch code on submit.
    await expectApiError(
      await request.post('/api/join', {
        data: { code: 'ZZZZZZZZ', grade: 8, studentName: 'A', parentName: 'B', parentPhone: '1', planId: w.seed.planId, username: 'no.branch', password: 'valid-pass-1' },
      }),
      404,
      'INVALID_CODE',
    );
    expect(await userCount('no.branch')).toBe(0);
    expect(await userCount('ghost.plan')).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Invite links (/invite/[token])
// ---------------------------------------------------------------------------------------------------------------

test.describe('invite link', () => {
  async function addInvitedStudent(w: World, studentName = 'Invite Kid') {
    const res = await manualAddStudent(w.seed.a.schoolAdmin as Actor, {
      branchId: w.seed.a.branchId,
      grade: 8,
      studentName,
      parentName: 'Invite Parent',
      parentPhone: '9876543210',
    });
    return res;
  }

  test('I1 a valid invite sets credentials, shows the done state, and the link is then single-use', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w);
    const path = new URL(inv.inviteUrl).pathname;

    await page.goto(path);
    await expect(page.getByRole('heading', { name: "Set up Invite Kid's account at School A" })).toBeVisible();
    await expect(page.getByText('Branch A · Grade 8')).toBeVisible();

    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('Invite.Kid');
    await page.getByLabel('Username').blur();
    await expect(page.getByText('invite.kid is available.')).toBeVisible();
    await page.getByLabel('Password').fill('invite-kid-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(SUCCESS_COPY);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible();
    await expect(page.getByText(INVITE_UNAVAILABLE_COPY)).toBeVisible();

    // The new credentials work and the student is held on /status until payment.
    await login(page, { username: 'invite.kid', password: 'invite-kid-pass-1' });
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText(PENDING_COPY)).toBeVisible();
  });

  test('I2 an unknown or malformed token shows the unavailable state, and the API returns 410 INVITE_INVALID', async ({ page, request }) => {
    await freshWorld();
    await page.goto('/invite/this-token-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible();
    await expect(page.getByText(INVITE_UNAVAILABLE_COPY)).toBeVisible();

    const long = 'a'.repeat(250);
    await page.goto(`/invite/${long}`);
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible();

    await expectApiError(await request.get('/api/invite/this-token-does-not-exist'), 410, 'INVITE_INVALID');
    await expectApiError(await request.get(`/api/invite/${long}`), 410, 'INVITE_INVALID');
    await expectApiError(
      await request.post('/api/invite/this-token-does-not-exist', {
        data: { planId: '00000000-0000-4000-8000-000000000000', username: 'nobody.here', password: 'valid-pass-1' },
      }),
      410,
      'INVITE_INVALID',
    );
  });

  test('I3 an expired invite shows the unavailable state', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w);
    await withPlatform((tx) =>
      tx.update(invites).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(invites.studentUserId, inv.studentUserId)),
    );
    await page.goto(new URL(inv.inviteUrl).pathname);
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible();
    await expect(page.getByText(INVITE_UNAVAILABLE_COPY)).toBeVisible();
  });

  test('I4 a weak password on the invite shows an error and the same link still works after fixing it', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w, 'Weak Invite Kid');
    const path = new URL(inv.inviteUrl).pathname;
    await page.goto(path);
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill('weak.invite');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Password must be 8-128 characters');
    await expect(page.getByRole('heading', { name: "Set up Weak Invite Kid's account at School A" })).toBeVisible();

    await page.getByLabel('Password').fill('weak-invite-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toHaveText(SUCCESS_COPY);
  });

  test('I5 a taken username on the invite shows the taken message with suggestions', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w);
    await page.goto(new URL(inv.inviteUrl).pathname);
    await page.getByLabel(/Monthly/).check();
    await page.getByLabel('Username').fill(w.pendingStudent.username);
    await page.getByLabel('Password').fill('invite-taken-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText(TAKEN_COPY);
    await expect(page.getByRole('button', { name: new RegExp(`^${w.pendingStudent.username}\\d+$`) }).first()).toBeVisible();
  });

  test('I6 the submit button stays disabled until a plan is chosen on the invite', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w);
    await page.goto(new URL(inv.inviteUrl).pathname);
    await page.getByLabel('Username').fill('plan.later');
    await page.getByLabel('Password').fill('plan-later-pass-1');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('I7 a failed invite load shows a retryable error, and Try again recovers the form', async ({ page }) => {
    const w = await freshWorld();
    const inv = await addInvitedStudent(w, 'Retry Kid');
    const path = new URL(inv.inviteUrl).pathname;

    // Network failure on the invite lookup.
    await page.route('**/api/invite/**', (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()));
    await page.goto(path);
    await expect(page.locator('p[role="alert"]')).toHaveText("We couldn't reach the server. Check your connection and try again.");
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toHaveCount(0);
    await page.unroute('**/api/invite/**');

    // Server error on the invite lookup, then a retry that succeeds.
    await page.route('**/api/invite/**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }) })
        : route.continue(),
    );
    await page.reload();
    await expect(page.locator('p[role="alert"]')).toHaveText('Something went wrong. Please try again.');
    await page.unroute('**/api/invite/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: "Set up Retry Kid's account at School A" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Login (/login) and role homes
// ---------------------------------------------------------------------------------------------------------------

test.describe('login', () => {
  test('L1 each role is routed to its home after login', async ({ page }) => {
    const w = await freshWorld();
    const cases: Array<[Creds, RegExp]> = [
      [w.platform, /\/platform$/],
      [w.schoolAdmin, /\/school$/],
      [w.branchAdmin, /\/school$/],
      [w.teacher, /\/teacher$/],
      [w.pendingStudent, /\/status$/],
    ];
    for (const [creds, home] of cases) {
      await login(page, creds);
      await expect(page).toHaveURL(home);
      // Start the next case from a logged-out page.
      await page.context().clearCookies();
    }
  });

  test('L2 a wrong password shows the error, clears the password, and an unknown username gets the same message', async ({ page, request }) => {
    const w = await freshWorld();
    await page.goto('/login');
    await page.getByLabel('Username').fill(w.pendingStudent.username);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Incorrect username or password.');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Password')).toHaveValue('');

    await page.getByLabel('Username').fill('nobody.has.this');
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Incorrect username or password.');

    // The API gives the same envelope for an unknown user and a wrong password (no enumeration).
    const wrong = await request.post('/api/auth/login', { data: { username: w.pendingStudent.username, password: 'nope-nope' } });
    const unknown = await request.post('/api/auth/login', { data: { username: 'nobody.has.this', password: 'nope-nope' } });
    await expectApiError(wrong, 401, 'INVALID_CREDENTIALS');
    await expectApiError(unknown, 401, 'INVALID_CREDENTIALS');
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  test('L3 empty fields are blocked by the browser and no login request is sent', async ({ page }) => {
    await freshWorld();
    let loginPosts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/auth/login')) loginPosts++;
    });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Log in' }).click();
    const valid = await page.getByLabel('Username').evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(valid).toBe(false);
    expect(loginPosts).toBe(0);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('L4 an empty password through the API is rejected as a validation error', async ({ request }) => {
    await freshWorld();
    await expectApiError(await request.post('/api/auth/login', { data: { username: 'someone', password: '' } }), 400, 'VALIDATION');
  });

  test('L5 a removed student is told the account is inactive with the right password, and a wrong password still gets the generic message', async ({ page, request }) => {
    const w = await freshWorld();
    const signed = await signupWithCode({
      code: w.code, grade: 8, studentName: 'Removed Kid', parentName: 'Parent', parentPhone: '9876543210',
      planId: w.seed.planId, username: 'removed.kid', password: 'removed-kid-pass-1',
    });
    await removeStudent(w.seed.a.schoolAdmin as Actor, signed.studentUserId);

    await page.goto('/login');
    await page.getByLabel('Username').fill('removed.kid');
    await page.getByLabel('Password').fill('removed-kid-pass-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('This account is no longer active. Contact your school.');

    await page.getByLabel('Username').fill('removed.kid');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Incorrect username or password.');

    await expectApiError(
      await request.post('/api/auth/login', { data: { username: 'removed.kid', password: 'removed-kid-pass-1' } }),
      403,
      'ACCOUNT_REMOVED',
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Logout and logged-out guards
// ---------------------------------------------------------------------------------------------------------------

test.describe('logout and guards', () => {
  test('O1 a student logs out from /status, returns to /login, and the old session no longer works on the server', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.pendingStudent);
    await expect(page).toHaveURL(/\/status$/);
    const sid = (await page.context().cookies()).find((c) => c.name === 'sid')!;
    expect(sid).toBeTruthy();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/status');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/login$/);

    // Replaying the old token is rejected: the session was revoked, not only the cookie cleared.
    const replay = await page.request.get('/api/me', { headers: { cookie: `sid=${sid.value}` } });
    expect(replay.status()).toBe(401);
    expect((await replay.json()).error.code).toBe('UNAUTHENTICATED');
  });

  test('O2 a staff user logs out from the header and protected staff pages then redirect to /login', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.schoolAdmin);
    await expect(page).toHaveURL(/\/school$/);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/school');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('O3 logged-out visits to protected pages redirect to /login', async ({ page }) => {
    await freshWorld();
    for (const path of ['/', '/learn', '/school', '/teacher', '/platform', '/status']) {
      await page.goto(path);
      await expect(page, `GET ${path}`).toHaveURL(/\/login$/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Status page (/status) and the /api/me endpoints
// ---------------------------------------------------------------------------------------------------------------

test.describe('status and me', () => {
  test('S1 a pending student sees the activation message and no payment action, only log out', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.pendingStudent);
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(page.getByText(PENDING_COPY)).toBeVisible();
    await expect(page.getByRole('button', { name: /pay|renew|subscri|checkout|upgrade/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('S2 a non-student on /status sees a signed-in note instead of a student state', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.schoolAdmin);
    await expect(page).toHaveURL(/\/school$/);
    await page.goto('/status');
    await expect(page.getByText('Signed in as school-admin A.')).toBeVisible();
    await expect(page.getByText(PENDING_COPY)).toHaveCount(0);
  });

  test('S3 a removed student who is signed in is sent to /login on the next load', async ({ page }) => {
    const w = await freshWorld();
    const signed = await signupWithCode({
      code: w.code, grade: 8, studentName: 'Kicked Kid', parentName: 'Parent', parentPhone: '9876543210',
      planId: w.seed.planId, username: 'kicked.kid', password: 'kicked-kid-pass-1',
    });
    await login(page, { username: 'kicked.kid', password: 'kicked-kid-pass-1' });
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText(PENDING_COPY)).toBeVisible();

    await removeStudent(w.seed.a.schoolAdmin as Actor, signed.studentUserId);

    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('S4 an active student is sent to /learn from /status, and a lapsed student sees the renewal message', async () => {
    // Not runnable here: both states need a recorded payment (active) or an active subscription whose period
    // has ended (lapsed). Recording payments is out of scope for this journey run.
    test.skip(true, 'active/lapsed states need a recorded payment, which is out of scope for this run');
  });

  test('M1 logged-out /api/me and /api/me/status return 401 UNAUTHENTICATED', async ({ request }) => {
    await freshWorld();
    await expectApiError(await request.get('/api/me'), 401, 'UNAUTHENTICATED');
    await expectApiError(await request.get('/api/me/status'), 401, 'UNAUTHENTICATED');
  });

  test('M2 a pending student gets the me and status envelopes', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.pendingStudent);
    await expect(page).toHaveURL(/\/status$/);
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ name: 'student A', roles: ['student'], isPlatformAdmin: false });

    const st = await page.request.get('/api/me/status');
    expect(st.status()).toBe(200);
    expect(await st.json()).toEqual({ status: 'pending_payment', planName: 'Monthly', periodEnd: null });
  });

  test('M3 a school admin gets roles from /api/me, and /api/me/status is forbidden for non-students', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.schoolAdmin);
    await expect(page).toHaveURL(/\/school$/);
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ name: 'school-admin A', roles: ['school_admin'], isPlatformAdmin: false });
    await expectApiError(await page.request.get('/api/me/status'), 403, 'FORBIDDEN');
  });

  test('M4 a platform admin gets isPlatformAdmin true from /api/me', async ({ page }) => {
    const w = await freshWorld();
    await login(page, w.platform);
    await expect(page).toHaveURL(/\/platform$/);
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).isPlatformAdmin).toBe(true);
  });

  test('M5 a removed student\'s session no longer works on /api/me or /api/me/status', async ({ page }) => {
    const w = await freshWorld();
    const signed = await signupWithCode({
      code: w.code, grade: 8, studentName: 'Gone Kid', parentName: 'Parent', parentPhone: '9876543210',
      planId: w.seed.planId, username: 'gone.kid', password: 'gone-kid-pass-1',
    });
    await login(page, { username: 'gone.kid', password: 'gone-kid-pass-1' });
    await expect(page).toHaveURL(/\/status$/);
    await removeStudent(w.seed.a.schoolAdmin as Actor, signed.studentUserId);
    await expectApiError(await page.request.get('/api/me'), 401, 'UNAUTHENTICATED');
    await expectApiError(await page.request.get('/api/me/status'), 401, 'UNAUTHENTICATED');
  });
});
