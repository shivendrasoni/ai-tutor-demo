import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { messages, plans, schools, usageDaily, users } from '@/db/schema';
import { insertMessage } from '../../tests/helpers/analytics-seed';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';
import { login, type Creds } from '../helpers/seed';

/*
 * Platform admin journeys (/platform/** and /api/platform/**). Every test re-seeds through resetDb + seedTwoSchools
 * plus the flagged-conversation / usage / routing rows below. Payments (/platform/payments, POST /api/platform/payments)
 * are out of scope for this journey file and are never visited.
 */

const DAY_MS = 86_400_000;
const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
const ago = (ms: number) => new Date(Date.now() - ms);

type World = {
  seed: Seed;
  platform: Creds;
  schoolAdmin: Creds; // school A
  teacher: Creds; // school A
  pendingStudent: Creds; // school A, pending subscription
  flagOpenA: string; // flagged assistant message in school A (conversation with 3 messages)
  flagOpenB: string; // flagged assistant message in school B (its own conversation)
  plainMessageA: string; // unflagged assistant message in the school A conversation
  flagReason: string;
};

async function credsFor(userId: string): Promise<Creds> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return { username: u.username!, password: SEED_PASSWORD };
}

async function conversationIdOf(messageId: string): Promise<string> {
  const [m] = await withPlatform((tx) =>
    tx.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, messageId)),
  );
  return m.conversationId;
}

async function seedPlatformWorld(): Promise<World> {
  await resetDb();
  const seed = await seedTwoSchools();
  const A = seed.a;
  const B = seed.b;

  // School A conversation: a student question, the flagged tutor reply, an unflagged tutor reply.
  const q = await insertMessage({
    schoolId: A.schoolId, studentId: A.studentId, role: 'user',
    content: 'Can you just give me the answers to today test?', createdAt: ago(120_000),
  });
  const convA = await conversationIdOf(q);
  const flagReason = 'asks for test answers';
  const flagOpenA = await insertMessage({
    schoolId: A.schoolId, studentId: A.studentId, role: 'assistant', conversationId: convA,
    content: 'Here is the answer key: 1) 4  2) 9', flagged: true, flagReason, createdAt: ago(60_000),
  });
  const plainMessageA = await insertMessage({
    schoolId: A.schoolId, studentId: A.studentId, role: 'assistant', conversationId: convA,
    content: 'Let us work through it step by step instead.', createdAt: ago(30_000),
  });

  // School B: its own flagged conversation (newer, so it sorts first in the open list).
  const flagOpenB = await insertMessage({
    schoolId: B.schoolId, studentId: B.studentId, role: 'assistant',
    content: 'Flagged reply in school B', flagged: true, flagReason: 'unsafe content', createdAt: ago(10_000),
  });

  // Usage (cost by school): 0.50 today and 1.25 ten days ago, both school A.
  await withPlatform((tx) =>
    tx.insert(usageDaily).values([
      { schoolId: A.schoolId, studentId: A.studentId, date: isoDay(0), tokens: 100, cost: '0.5' },
      { schoolId: A.schoolId, studentId: A.studentId, date: isoDay(10), tokens: 500, cost: '1.25' },
    ]),
  );

  // Routing decisions: 4 turns in the last 7 days (advanced, standard, off-topic block, unsafe block),
  // plus one advanced turn ten days ago that only the 30-day window sees.
  const decide = (decisions: object, createdAt: Date) =>
    insertMessage({ schoolId: A.schoolId, studentId: A.studentId, role: 'assistant', content: 'routed', decisions, createdAt });
  await decide({ tier: 'advanced' }, ago(50_000));
  await decide({ tier: 'standard' }, ago(40_000));
  await decide({ fixedReply: 'off_topic' }, ago(35_000));
  await decide({ fixedReply: 'unsafe' }, ago(34_000));
  await decide({ tier: 'advanced' }, new Date(Date.now() - 10 * DAY_MS));

  return {
    seed,
    platform: await credsFor(seed.platform.userId),
    schoolAdmin: await credsFor(A.schoolAdmin.userId!),
    teacher: await credsFor(A.teacher.userId!),
    pendingStudent: await credsFor(A.studentId),
    flagOpenA,
    flagOpenB,
    plainMessageA,
    flagReason,
  };
}

/** Text of the value cell of a <Stat label="..."> (the value div is the sibling before the label div). */
async function statValue(page: Page, label: string): Promise<string> {
  return (await page.getByText(label, { exact: true }).locator('xpath=preceding-sibling::div[1]').innerText()).trim();
}

/** Logs in through the UI and waits for the post-login redirect, so the next navigation cannot race it. */
async function signIn(page: Page, creds: Creds): Promise<void> {
  await login(page, creds);
  await expect(page).not.toHaveURL(/\/login$/);
}

let world: World;
const openContexts: BrowserContext[] = [];

test.beforeEach(async () => {
  world = await seedPlatformWorld();
});

test.afterEach(async () => {
  while (openContexts.length) await openContexts.pop()!.close();
});

/** A fresh browser context logged in as `creds`; its `request` shares the session cookie. */
async function sessionFor(browser: import('@playwright/test').Browser, creds: Creds) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  openContexts.push(ctx);
  const page = await ctx.newPage();
  await login(page, creds);
  await expect(page).not.toHaveURL(/\/login$/);
  return ctx;
}

async function dbCount(table: 'schools' | 'plans'): Promise<number> {
  const rows = await withPlatform((tx) => (table === 'schools' ? tx.select({ id: schools.id }).from(schools) : tx.select({ id: plans.id }).from(plans)));
  return rows.length;
}

// ---------------------------------------------------------------- Overview

test('overview shows live numbers and every platform nav link', async ({ page }) => {
  await signIn(page, world.platform);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toBeVisible();
  expect(await statValue(page, 'Pending payments')).toBe('2'); // one pending subscription per seeded school student
  expect(await statValue(page, 'Open flags')).toBe('2');
  expect(await statValue(page, 'Cost, last 30 days')).toBe('$1.75'); // 0.50 + 1.25 USD

  const nav = page.getByRole('navigation', { name: 'Platform' });
  for (const label of ['Overview', 'Payments', 'Schools', 'Plans', 'Flags', 'Costs', 'Routing', 'Content']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await nav.getByRole('link', { name: 'Schools', exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/schools$/);
  await expect(page.getByRole('heading', { name: 'Schools', exact: true })).toBeVisible();
});

test('staff header: Home returns to the platform overview and Log out ends the session', async ({ page }) => {
  await signIn(page, world.platform);
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/platform/schools');
  const header = page.getByRole('navigation', { name: 'Account' });
  await expect(header.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/platform');
  await header.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/platform$/);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/login$/); // session is gone
});

// ---------------------------------------------------------------- Schools

test('schools list shows each school with its branches and signup code', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await expect(page.getByRole('heading', { name: 'School A (CBSE)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'School B (CBSE)', exact: true })).toBeVisible();
  const branchA = page.locator('li', { hasText: 'Branch A' });
  await expect(branchA).toContainText(world.seed.a.code);
  await expect(branchA.getByText('enabled', { exact: true })).toBeVisible();
});

test('platform admin creates a school and it appears in the list', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await page.getByLabel('Name', { exact: true }).fill('Gamma Public School');
  await page.getByLabel('Board', { exact: true }).fill('ICSE');
  await page.getByRole('button', { name: 'Create school' }).click();
  await expect(page.getByRole('heading', { name: 'Gamma Public School (ICSE)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gamma Public School (ICSE)', exact: true }).locator('xpath=..')).toContainText('No branches yet');
  expect(await dbCount('schools')).toBe(3);
});

test('school name that is only spaces is rejected with a message and nothing is created', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByLabel('Board', { exact: true }).fill('CBSE');
  await page.getByRole('button', { name: 'Create school' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Invalid request');
  expect(await dbCount('schools')).toBe(2);
});

test('creating a school with a name that already exists is accepted (no uniqueness rule)', async ({ page }) => {
  // Observation test: the spec sets no uniqueness rule for school names, so a duplicate is allowed today.
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await page.getByLabel('Name', { exact: true }).fill('School A');
  await page.getByLabel('Board', { exact: true }).fill('CBSE');
  await page.getByRole('button', { name: 'Create school' }).click();
  await expect(page.getByRole('heading', { name: 'School A (CBSE)', exact: true })).toHaveCount(2);
  expect(await dbCount('schools')).toBe(3);
});

test('platform admin creates a branch under a school from the form', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await page.locator('select[name="schoolId"]').selectOption({ label: 'School B' });
  await page.getByLabel('Branch name', { exact: true }).fill('North Campus');
  await page.getByRole('button', { name: 'Create branch' }).click();
  const schoolB = page.locator('section', { has: page.getByRole('heading', { name: 'School B (CBSE)', exact: true }) });
  await expect(schoolB.locator('li', { hasText: 'North Campus' })).toBeVisible();
  await expect(schoolB.locator('li', { hasText: 'North Campus' }).getByText('enabled', { exact: true })).toBeVisible();
  // The new branch belongs to school B only.
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'School A (CBSE)', exact: true }) })).not.toContainText('North Campus');
});

test('branch name that is only spaces is rejected with a message', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  await page.getByLabel('Branch name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Invalid request');
});

test('branch creation for an unknown or malformed school id is 404 NOT_FOUND', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/schools');
  for (const id of [randomUUID(), 'not-a-uuid']) {
    const res = await page.request.post(`/api/platform/schools/${id}/branches`, { data: { name: 'Ghost branch' } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  }
});

test('schools API: GET lists both schools, POST validates the body with the standard envelope', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const list = await ctx.request.get('/api/platform/schools');
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.schools.map((s: { name: string }) => s.name).sort()).toEqual(['School A', 'School B']);

  const missing = await ctx.request.post('/api/platform/schools', { data: { board: 'CBSE' } });
  expect(missing.status()).toBe(400);
  const err = (await missing.json()).error;
  expect(err.code).toBe('VALIDATION');
  expect(err.details.issues.map((i: { path: string }) => i.path)).toContain('name');

  const notJson = await ctx.request.post('/api/platform/schools', { headers: { 'content-type': 'text/plain' }, data: 'name=x' });
  expect(notJson.status()).toBe(400);
  expect((await notJson.json()).error.code).toBe('VALIDATION');

  const created = await ctx.request.post('/api/platform/schools', { data: { name: 'API School', board: 'State' } });
  expect(created.status()).toBe(201);
  expect(typeof (await created.json()).id).toBe('string');
});

// ---------------------------------------------------------------- Plans

test('plans page lists the seeded Monthly plan with its price', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/plans');
  const row = page.getByRole('row', { name: /Monthly/ });
  await expect(row).toContainText('monthly');
  await expect(row).toContainText('499.00');
});

test('platform admin creates an annual plan and the price is shown in major units', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/plans');
  await page.getByLabel('Name', { exact: true }).fill('Annual Plus');
  await page.locator('select[name="interval"]').selectOption('annual');
  await page.getByLabel('Price (major units)', { exact: true }).fill('4999.50');
  await page.getByRole('button', { name: 'Create plan' }).click();
  const row = page.getByRole('row', { name: /Annual Plus/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('annual');
  await expect(row).toContainText('4,999.50');
  expect(await dbCount('plans')).toBe(2);
});

test('plan price with more than 2 decimals is rejected in the form, nothing is created', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/plans');
  await page.getByLabel('Name', { exact: true }).fill('Bad Price');
  await page.getByLabel('Price (major units)', { exact: true }).fill('10.005');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Enter an amount with at most 2 decimals');
  expect(await dbCount('plans')).toBe(1);
});

test('plan price that is not a number is rejected in the form', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/plans');
  await page.getByLabel('Name', { exact: true }).fill('Words Price');
  await page.getByLabel('Price (major units)', { exact: true }).fill('free');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Enter an amount with at most 2 decimals');
  expect(await dbCount('plans')).toBe(1);
});

test('plan currency must be three letters (browser validation blocks the request)', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/plans');
  await page.getByLabel('Name', { exact: true }).fill('Short Currency');
  await page.getByLabel('Price (major units)', { exact: true }).fill('100');
  await page.getByLabel('Currency', { exact: true }).fill('US');
  await page.getByRole('button', { name: 'Create plan' }).click();
  const valid = await page.getByLabel('Currency', { exact: true }).evaluate((el) => (el as HTMLInputElement).validity.valid);
  expect(valid).toBe(false);
  expect(await dbCount('plans')).toBe(1);
});

test('plans API: duplicate names are accepted (no uniqueness rule), invalid bodies get 400 VALIDATION', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const dup = await ctx.request.post('/api/platform/plans', { data: { name: 'Monthly', interval: 'monthly', priceMinor: 100 } });
  expect(dup.status()).toBe(201); // observation: same name as the seeded plan is allowed
  const weekly = await ctx.request.post('/api/platform/plans', { data: { name: 'Weekly', interval: 'weekly', priceMinor: 100 } });
  expect(weekly.status()).toBe(400);
  expect((await weekly.json()).error.code).toBe('VALIDATION');
  const negative = await ctx.request.post('/api/platform/plans', { data: { name: 'Neg', interval: 'monthly', priceMinor: -5 } });
  expect(negative.status()).toBe(400);
  expect((await negative.json()).error.code).toBe('VALIDATION');
  const list = await ctx.request.get('/api/platform/plans');
  expect((await list.json()).plans.length).toBe(2);
});

// ---------------------------------------------------------------- Flags

test('open flags list shows the two open flagged messages; reviewed tab is empty', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/flags');
  await expect(page.getByRole('heading', { name: 'Flagged conversations', exact: true })).toBeVisible();
  const rows = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Open', exact: true }) });
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('row', { name: /School A/ })).toContainText('asks for test answers');
  await expect(page.getByRole('row', { name: /School B/ })).toContainText('unsafe content');

  await page.getByRole('link', { name: 'Reviewed', exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/flags\?status=reviewed$/);
  await expect(page.getByText('No flagged conversations', { exact: true })).toBeVisible();
});

test('flags API: status filter returns open and reviewed sets, invalid status is 400 VALIDATION', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const open = await (await ctx.request.get('/api/platform/flags?status=open')).json();
  expect(open.flags.map((f: { messageId: string }) => f.messageId).sort()).toEqual([world.flagOpenA, world.flagOpenB].sort());
  expect(typeof open.flags[0].createdAt).toBe('string');
  const defaulted = await (await ctx.request.get('/api/platform/flags')).json();
  expect(defaulted.flags.length).toBe(2);

  const reviewed = await (await ctx.request.get('/api/platform/flags?status=reviewed')).json();
  expect(reviewed.flags).toEqual([]);

  const bad = await ctx.request.get('/api/platform/flags?status=closed');
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe('VALIDATION');
});

test('flags page with an invalid status shows the validation message', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/flags?status=closed');
  await expect(page.getByText('status must be open or reviewed', { exact: true })).toBeVisible();
});

test('opening a flagged conversation shows the thread and highlights the flagged message', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/flags');
  await page.getByRole('row', { name: /School A/ }).getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/flags/${world.flagOpenA}$`));
  await expect(page.getByRole('heading', { name: 'Flagged conversation', exact: true })).toBeVisible();

  const items = page.locator('ol li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Can you just give me the answers to today test?');
  await expect(items.nth(0)).toContainText('Student');
  const flagged = page.locator('li[data-flagged="true"]');
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toContainText('Here is the answer key');
  await expect(flagged).toContainText(`(flagged: ${world.flagReason})`);
  await expect(items.nth(2)).not.toHaveAttribute('data-flagged', 'true');
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
});

test('marking a flag reviewed shows "Reviewed on" with today and the button disappears, and it survives reload', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto(`/platform/flags/${world.flagOpenA}`);
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  const reviewed = page.getByText(/Reviewed on \d{4}-\d{2}-\d{2}/);
  await expect(reviewed).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await expect(reviewed).toHaveText(`Reviewed on ${today}`);
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/Reviewed on \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0);

  // Open list drops it, reviewed list picks it up.
  await page.goto('/platform/flags');
  await expect(page.getByRole('row', { name: /School A/ })).toHaveCount(0);
  await page.goto('/platform/flags?status=reviewed');
  await expect(page.getByRole('row', { name: /School A/ })).toContainText('asks for test answers');
});

test('review is idempotent: a second POST is 204 and keeps the original reviewed_at', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const first = await ctx.request.post(`/api/platform/flags/${world.flagOpenB}/review`);
  expect(first.status()).toBe(204);
  const stamp = async () => {
    const [m] = await withPlatform((tx) => tx.select({ r: messages.reviewedAt, by: messages.reviewedBy }).from(messages).where(eq(messages.id, world.flagOpenB)));
    return m;
  };
  const before = await stamp();
  expect(before.r).not.toBeNull();
  const second = await ctx.request.post(`/api/platform/flags/${world.flagOpenB}/review`);
  expect(second.status()).toBe(204);
  const after = await stamp();
  expect(after.r!.getTime()).toBe(before.r!.getTime());
  expect(after.by).toBe(before.by);
});

test('review of an unknown, malformed, or unflagged message is 404 NOT_FOUND', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  for (const id of [randomUUID(), 'not-a-uuid', world.plainMessageA]) {
    const res = await ctx.request.post(`/api/platform/flags/${id}/review`);
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  }
  const [m] = await withPlatform((tx) => tx.select({ r: messages.reviewedAt }).from(messages).where(eq(messages.id, world.plainMessageA)));
  expect(m.r).toBeNull();
});

test('flagged conversation page: unknown and malformed message ids render the 404 page', async ({ page }) => {
  await signIn(page, world.platform);
  for (const id of [randomUUID(), 'not-a-uuid', world.plainMessageA]) {
    const res = await page.goto(`/platform/flags/${id}`);
    expect(res?.status()).toBe(404);
  }
});

// ---------------------------------------------------------------- Costs

test('costs page: 7-day window by default, toggling to 30 days changes the school cost', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/costs');
  await expect(page.getByRole('heading', { name: 'Costs', exact: true })).toBeVisible();
  await expect(page.getByText('Last 7 days', { exact: true })).toHaveCount(1); // bold, not a link
  const schoolA = page.getByRole('row', { name: /School A/ });
  await expect(schoolA).toContainText('$0.5000');

  await page.getByRole('link', { name: 'Last 30 days' }).click();
  await expect(page).toHaveURL(/\/platform\/costs\?days=30$/);
  await expect(page.getByText('Last 30 days', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /School A/ })).toContainText('$1.7500');
  await expect(page.getByRole('row', { name: /School B/ })).toContainText('$0.0000');
});

test('costs page: invalid days shows the validation message; API returns 400 VALIDATION', async ({ page, browser }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/costs?days=3');
  await expect(page.getByText('days must be 7 or 30', { exact: true })).toBeVisible();

  const ctx = await sessionFor(browser, world.platform);
  const bad = await ctx.request.get('/api/platform/costs?days=3');
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe('VALIDATION');
});

test('costs API: 7 and 30 day windows and the by-school totals', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const seven = await (await ctx.request.get('/api/platform/costs?days=7')).json();
  const thirty = await (await ctx.request.get('/api/platform/costs?days=30')).json();
  const a7 = seven.bySchool.find((s: { name: string }) => s.name === 'School A');
  const a30 = thirty.bySchool.find((s: { name: string }) => s.name === 'School A');
  expect(a7.cost).toBeCloseTo(0.5, 4);
  expect(a30.cost).toBeCloseTo(1.75, 4);
  expect(a30.tokens).toBe(600);
  expect(a30.students).toBe(1);
  expect(thirty.bySchool.map((s: { name: string }) => s.name).sort()).toEqual(['School A', 'School B']);
  const defaulted = await (await ctx.request.get('/api/platform/costs')).json();
  expect(defaulted.bySchool.find((s: { name: string }) => s.name === 'School A').cost).toBeCloseTo(0.5, 4);
});

// ---------------------------------------------------------------- Routing

test('routing page: 7-day and 30-day stats differ as seeded', async ({ page }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/routing');
  await expect(page.getByText('Routing health', { exact: true })).toBeVisible();
  expect(await statValue(page, 'Turns')).toBe('4');
  expect(await statValue(page, 'Advanced share')).toBe('50%'); // 1 advanced of 2 tiered turns
  expect(await statValue(page, 'Off-topic blocks')).toBe('1');
  expect(await statValue(page, 'Unsafe blocks')).toBe('1');
  expect(await statValue(page, 'Filter fallbacks')).toBe('0');
  expect(await statValue(page, 'Decider errors')).toBe('0');
  expect(await statValue(page, 'Decider fallbacks')).toBe('0');

  await page.getByRole('link', { name: 'Last 30 days' }).click();
  await expect(page).toHaveURL(/\/platform\/routing\?days=30$/);
  expect(await statValue(page, 'Turns')).toBe('5');
  expect(await statValue(page, 'Advanced share')).toBe('67%'); // 2 advanced of 3 tiered turns
});

test('routing page and API: invalid days handled; API returns the stats shape', async ({ page, browser }) => {
  await signIn(page, world.platform);
  await page.goto('/platform/routing?days=90');
  await expect(page.getByText('days must be 7 or 30', { exact: true })).toBeVisible();

  const ctx = await sessionFor(browser, world.platform);
  const ok = await (await ctx.request.get('/api/platform/routing?days=7')).json();
  expect(ok).toEqual({
    turns: 4, advancedShare: 0.5, offTopicBlocks: 1, unsafeBlocks: 1,
    filterFallbacks: 0, deciderErrors: 0, deciderFallbacks: 0,
  });
  const bad = await ctx.request.get('/api/platform/routing?days=abc');
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe('VALIDATION');
});

// ---------------------------------------------------------------- Pending (read only)

test('pending API (read only) lists the pending subscriptions for the platform admin', async ({ browser }) => {
  const ctx = await sessionFor(browser, world.platform);
  const res = await ctx.request.get('/api/platform/pending');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.pending.length).toBe(2);
  expect(body.pending.map((p: { schoolName: string }) => p.schoolName).sort()).toEqual(['School A', 'School B']);
});

// ---------------------------------------------------------------- Access control

const PLATFORM_PAGES = (flagId: string) => [
  '/platform', '/platform/schools', '/platform/plans', '/platform/flags', `/platform/flags/${flagId}`,
  '/platform/costs', '/platform/routing',
];

for (const [who, landing] of [['school admin', '/school'], ['teacher', '/teacher'], ['pending student', '/status']] as const) {
  test(`${who} is redirected to their own home from every platform page`, async ({ browser }) => {
    const creds = who === 'school admin' ? world.schoolAdmin : who === 'teacher' ? world.teacher : world.pendingStudent;
    const ctx = await sessionFor(browser, creds);
    const page = await ctx.newPage();
    for (const path of PLATFORM_PAGES(world.flagOpenA)) {
      await page.goto(path);
      await expect(page, `${path} should redirect`).toHaveURL(new RegExp(`${landing}$`));
      await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toHaveCount(0);
    }
  });

  test(`${who} gets 403 FORBIDDEN from every platform API route and changes nothing`, async ({ browser }) => {
    const creds = who === 'school admin' ? world.schoolAdmin : who === 'teacher' ? world.teacher : world.pendingStudent;
    const ctx = await sessionFor(browser, creds);
    const schoolsBefore = await dbCount('schools');
    const plansBefore = await dbCount('plans');
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/platform/schools'],
      ['POST', '/api/platform/schools', { name: 'Sneaky School', board: 'CBSE' }],
      ['GET', '/api/platform/plans'],
      ['POST', '/api/platform/plans', { name: 'Sneaky', interval: 'monthly', priceMinor: 100 }],
      ['GET', '/api/platform/flags?status=open'],
      ['POST', `/api/platform/flags/${world.flagOpenA}/review`],
      ['GET', '/api/platform/costs?days=7'],
      ['GET', '/api/platform/routing?days=7'],
      ['GET', '/api/platform/pending'],
    ];
    for (const [method, url, data] of calls) {
      const res = method === 'GET' ? await ctx.request.get(url) : await ctx.request.post(url, { data: data ?? undefined });
      expect(res.status(), `${method} ${url}`).toBe(403);
      expect((await res.json()).error.code, `${method} ${url}`).toBe('FORBIDDEN');
    }
    expect(await dbCount('schools')).toBe(schoolsBefore);
    expect(await dbCount('plans')).toBe(plansBefore);
    const [m] = await withPlatform((tx) => tx.select({ r: messages.reviewedAt }).from(messages).where(eq(messages.id, world.flagOpenA)));
    expect(m.r).toBeNull();
  });
}

test('school admin of another school gets 403 FORBIDDEN creating a branch under the platform route', async ({ browser }) => {
  // School A admin naming school B: createBranch asserts canManageSchool, so this must be refused.
  const ctx = await sessionFor(browser, world.schoolAdmin);
  const res = await ctx.request.post(`/api/platform/schools/${world.seed.b.schoolId}/branches`, { data: { name: 'Intruder' } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe('FORBIDDEN');
});

test('school admin naming their OWN school on the platform branches route must get 403 (platform-only route)', async ({ browser }) => {
  // BUG CHECK: /api/platform/* is a platform-only surface, but createBranch also lets a school_admin manage
  // their own school, so this request is expected to be refused with 403 but may succeed with 201.
  const ctx = await sessionFor(browser, world.schoolAdmin);
  const res = await ctx.request.post(`/api/platform/schools/${world.seed.a.schoolId}/branches`, { data: { name: 'Sneaky Branch' } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe('FORBIDDEN');
});

test('a signed-out visitor is sent to /login from platform pages and gets 401 from the API', async ({ page, request }) => {
  await page.goto('/platform/costs');
  await expect(page).toHaveURL(/\/login$/);
  const res = await request.get('/api/platform/costs?days=7');
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
});

// ---------------------------------------------------------------- Mobile layout

for (const path of ['/platform', '/platform/schools', '/platform/flags']) {
  test(`no horizontal page scroll at 390px on ${path}`, async ({ page }) => {
    await signIn(page, world.platform);
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Platform' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
