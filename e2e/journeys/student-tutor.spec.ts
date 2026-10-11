import { eq } from 'drizzle-orm';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { withPlatform } from '@/db/client';
import { subscriptions, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { seedSkills } from '@/modules/tutor/skills';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';
import { activateStudent, seedStudyContent } from '../../tests/helpers/study';

/*
 * Student tutor journeys: /learn list, subject and skill pickers, chat (mock model), citations, feedback,
 * access control between students and schools, non-active redirects, and the 390px layout.
 * Each test resets and seeds the DB, so the tests are independent.
 */

const NIL = '00000000-0000-4000-8000-00000000dead';
const UUID_RE = /\/learn\/c\/[0-9a-f-]{36}$/;

type Msg = { id: string; role: 'user' | 'assistant'; content: string; citations: unknown[]; feedback: string | null };

let seed: Seed;
let learnerName: string; // username of seed.a.student (active)
let secondName: string; // second active student in school A
let secondId: string;
let pendingName: string; // pending student in school A (never activated)

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u!.username!;
}

async function uiLogin(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Wait for the redirect to the student's home (/learn when active, /status otherwise) so a following goto
  // does not cancel the login request.
  await page.waitForURL(/\/(learn|status)$/);
}

/** Logs in through the API and returns a Cookie header for a request that must act as this user. */
async function cookieFor(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { username, password: SEED_PASSWORD } });
  expect(res.status()).toBe(200);
  const sid = /sid=([^;]+)/.exec(res.headers()['set-cookie'] ?? '')?.[1];
  expect(sid, 'login must set the sid cookie').toBeTruthy();
  return `sid=${sid}`;
}

/** Starts a chat through the UI with the given skill label and returns its URL. */
async function startChat(page: Page, skillLabel = 'Socratic'): Promise<string> {
  await page.goto('/learn');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel(skillLabel).check();
  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page).toHaveURL(UUID_RE);
  await expect(page.getByLabel('Your message')).toBeVisible();
  return page.url();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/** The chat id from a /learn/c/<id> URL. */
const idOf = (url: string) => url.split('/learn/c/')[1]!;

test.beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills();
  await seedStudyContent(seed.a);
  learnerName = await usernameOf(seed.a.student.userId!);

  // A second active student in the same school, and a pending one that was never activated.
  const second = await signupWithCode({
    code: seed.a.code, grade: 8, studentName: 'Second Kid', parentName: 'Parent Two', parentPhone: '9000000002',
    planId: seed.planId, username: 'second.learner', password: SEED_PASSWORD,
  });
  secondId = second.studentUserId;
  secondName = 'second.learner';
  await activateStudent({ userId: secondId, isPlatformAdmin: false, schoolId: seed.a.schoolId, branchId: seed.a.branchId, roles: ['student'] } as Actor);

  await signupWithCode({
    code: seed.a.code, grade: 8, studentName: 'Pending Kid', parentName: 'Parent Three', parentPhone: '9000000003',
    planId: seed.planId, username: 'pending.learner', password: SEED_PASSWORD,
  });
  pendingName = 'pending.learner';
});

test.describe('learn list and new chat', () => {
  test('a new student sees the empty state, then starts a socratic chat from the picker', async ({ page }) => {
    await uiLogin(page, learnerName);
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByText('No chats yet. Start one above.')).toBeVisible();

    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByText('How should the tutor help?')).toBeVisible();
    await expect(page.getByLabel('Socratic')).toBeChecked();
    await expect(page.getByLabel('Explain')).not.toBeChecked();
    await page.getByLabel('Explain').check();
    await expect(page.getByLabel('Socratic')).not.toBeChecked();
    await page.getByLabel('Socratic').check();

    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page).toHaveURL(UUID_RE);
    await expect(page.getByLabel('Your message')).toBeVisible();

    // The new chat has no messages yet and shows up in the list as "New chat" (no title until the first message).
    await page.goto('/learn');
    await expect(page.getByText('No chats yet.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New chat' })).toHaveCount(1);
  });

  test('cancel closes the picker without creating a conversation', async ({ page, request }) => {
    await uiLogin(page, learnerName);
    await page.getByRole('button', { name: 'New chat' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
    await expect(page.getByText('How should the tutor help?')).toHaveCount(0);
    const cookie = await cookieFor(request, learnerName);
    const res = await request.get('/api/tutor/conversations', { headers: { cookie } });
    expect(await res.json()).toEqual([]);
  });

  test('a subject picked in the new-chat form is stored on the conversation', async ({ page }) => {
    await uiLogin(page, learnerName);
    await page.getByRole('button', { name: 'New chat' }).click();
    const subject = page.getByLabel('Subject (optional)');
    await expect(subject).toBeVisible();
    await expect(subject.locator('option', { hasText: 'Mathematics' })).toHaveCount(1);
    await subject.selectOption({ label: 'Mathematics' });
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page).toHaveURL(UUID_RE);

    const res = await page.request.get('/api/tutor/conversations');
    const rows = (await res.json()) as { id: string; subjectId: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(idOf(page.url()));
    expect(rows[0]!.subjectId).toBe(seed.a.subjectId);
  });
});

test.describe('subjects and skills', () => {
  test('the chat skills endpoint lists socratic and explain, and rejects an unknown kind', async ({ request }) => {
    // Anonymous first: the request fixture keeps cookies from earlier logins in the same test.
    const anon = await request.get('/api/tutor/skills?kind=chat');
    expect(anon.status()).toBe(401);
    expect((await anon.json()).error.code).toBe('UNAUTHENTICATED');

    const cookie = await cookieFor(request, learnerName);
    const ok = await request.get('/api/tutor/skills?kind=chat', { headers: { cookie } });
    expect(ok.status()).toBe(200);
    const keys = ((await ok.json()) as { key: string; kind: string }[]).map((s) => s.key).sort();
    expect(keys).toEqual(['explain', 'socratic']);

    const bad = await request.get('/api/tutor/skills?kind=bogus', { headers: { cookie } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION');
  });

  test('the tutor subjects endpoint lists the subject with visible content; the staff subjects API refuses a student', async ({ request }) => {
    const cookie = await cookieFor(request, learnerName);
    const res = await request.get('/api/tutor/subjects', { headers: { cookie } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([{ id: seed.a.subjectId, name: 'Mathematics' }]);

    const staff = await request.get('/api/subjects', { headers: { cookie } });
    expect(staff.status()).toBe(403);
    expect((await staff.json()).error.code).toBe('FORBIDDEN');
  });
});

test.describe('chat', () => {
  test.setTimeout(120_000);

  test('a message gets a streamed tutor reply and the conversation title in the list', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Socratic');
    // The mock finds passages only for questions that name the seeded topic.
    const question = 'Tell me about topic 1 in Chapter 1';
    await sendMessage(page, question);

    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();
    await expect(page.getByLabel('Your message')).toHaveValue(''); // composer is cleared after send

    await page.goto('/learn');
    // The title is the first 60 characters of the first user message.
    await expect(page.getByRole('link', { name: question })).toBeVisible();
  });

  test('history survives a reload with both messages in order', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Socratic');
    await sendMessage(page, 'Tell me about topic 1 in Chapter 1');
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();

    await page.reload();
    await expect(page.getByText('Tell me about topic 1 in Chapter 1', { exact: true })).toBeVisible();
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();

    const res = await page.request.get(`/api/tutor/conversations/${idOf(page.url())}/messages`);
    const msgs = (await res.json()) as Msg[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0]!.content).toBe('Tell me about topic 1 in Chapter 1');
  });

  test('an empty or whitespace message is rejected by the composer and by the API', async ({ page, request }) => {
    await uiLogin(page, learnerName);
    const url = await startChat(page, 'Socratic');
    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();

    await page.getByLabel('Your message').fill('   ');
    await expect(send).toBeDisabled();
    await page.getByLabel('Your message').press('Enter');
    await expect(page.getByLabel('Your message')).toHaveValue('   ');
    await expect(page.getByText(/Let's work this out together/)).toHaveCount(0);
    // Next's dev route announcer is an empty role=alert, so only count alerts with text.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

    const cookie = await cookieFor(request, learnerName);
    const id = idOf(url);
    const api = await request.post(`/api/tutor/conversations/${id}/messages`, { headers: { cookie }, data: { text: '   ' } });
    expect(api.status()).toBe(400);
    expect((await api.json()).error.code).toBe('VALIDATION');
    const msgs = await request.get(`/api/tutor/conversations/${id}/messages`, { headers: { cookie } });
    expect(await msgs.json()).toEqual([]);
  });

  test('an answer from the explain skill cites the textbook passage in a Sources list', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Explain');
    await sendMessage(page, 'Tell me about topic 1 in Chapter 1');

    await expect(page.getByText(/According to your textbook/)).toBeVisible();
    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(sources).toBeVisible();
    await expect(sources.getByText(/^\[1\] /)).toBeVisible();
    await expect(sources.getByText(/Chapter 1/)).toBeVisible();
    await expect(sources.getByText(/p\. \d+/)).toBeVisible();
  });

  test('a question with no matching passage gets the beyond-textbook answer and no Sources list', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Explain');
    await sendMessage(page, 'zxqv blorf nonexistent topic');

    await expect(page.getByText(/This goes beyond your textbook\./)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sources' })).toHaveCount(0);
  });
});

test.describe('feedback', () => {
  test.setTimeout(120_000);

  test('a thumbs-down on a tutor reply persists after reload and is one-shot', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Socratic');
    await sendMessage(page, 'Tell me about topic 1 in Chapter 1');
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();

    const thumbs = page.getByRole('button', { name: 'Not helpful' });
    await expect(thumbs).toHaveCount(1); // only the tutor reply has a rating control, not the student's message
    await expect(thumbs).toBeEnabled();
    // The button disables optimistically; wait for the server to answer before reloading, or the reload aborts the POST.
    const saved = page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST');
    await thumbs.click();
    expect((await saved).status()).toBe(204);
    await expect(thumbs).toBeDisabled();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Not helpful' })).toBeDisabled();

    const msgs = (await (await page.request.get(`/api/tutor/conversations/${idOf(page.url())}/messages`)).json()) as Msg[];
    const reply = msgs.find((m) => m.role === 'assistant')!;
    expect(reply.feedback).toBe('down');
  });

  test('feedback on a message in another student\'s conversation is refused and changes nothing', async ({ page, request }) => {
    await uiLogin(page, learnerName);
    const url = await startChat(page, 'Socratic');
    const id = idOf(url);
    await sendMessage(page, 'Tell me about topic 1 in Chapter 1');
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();

    const owner = await cookieFor(request, learnerName);
    const msgs = (await (await request.get(`/api/tutor/conversations/${id}/messages`, { headers: { cookie: owner } })).json()) as Msg[];
    const reply = msgs.find((m) => m.role === 'assistant')!;

    const other = await cookieFor(request, secondName);
    const res = await request.post(`/api/tutor/messages/${reply.id}/feedback`, { headers: { cookie: other }, data: { rating: 'down' } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');

    const after = (await (await request.get(`/api/tutor/conversations/${id}/messages`, { headers: { cookie: owner } })).json()) as Msg[];
    expect(after.find((m) => m.id === reply.id)!.feedback).toBeNull();
  });
});

test.describe('access control', () => {
  test.setTimeout(120_000);

  test('a student cannot open or read another student\'s conversation in the same school', async ({ page, request }) => {
    // The owner creates a chat and sends a message with a recognisable text.
    const owner = await cookieFor(request, learnerName);
    const created = await request.post('/api/tutor/conversations', { headers: { cookie: owner }, data: { skillKey: 'socratic' } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const sent = await request.post(`/api/tutor/conversations/${id}/messages`, {
      headers: { cookie: owner }, data: { text: 'SECRET-OWNER-QUESTION about the moon' },
    });
    expect(sent.status()).toBe(200);

    // The second student is blocked at the API.
    const other = await cookieFor(request, secondName);
    const read = await request.get(`/api/tutor/conversations/${id}/messages`, { headers: { cookie: other } });
    expect(read.status()).toBe(404);
    const body = await read.text();
    expect(body).not.toContain('SECRET-OWNER-QUESTION');
    expect(JSON.parse(body).error.code).toBe('NOT_FOUND');

    const send = await request.post(`/api/tutor/conversations/${id}/messages`, {
      headers: { cookie: other }, data: { text: 'hello from the wrong student' },
    });
    expect(send.status()).toBe(404);

    // The second student's own list does not include the owner's chat and shows the empty state in the UI.
    const list = await request.get('/api/tutor/conversations', { headers: { cookie: other } });
    expect(await list.json()).toEqual([]);

    await uiLogin(page, secondName);
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByText('No chats yet. Start one above.')).toBeVisible();
    await page.goto(`/learn/c/${id}`);
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByText('SECRET-OWNER-QUESTION')).toHaveCount(0);
  });

  test('a student from another school gets 404 for the conversation and cannot use school A subjects', async ({ request }) => {
    const owner = await cookieFor(request, learnerName);
    const created = await request.post('/api/tutor/conversations', { headers: { cookie: owner }, data: { skillKey: 'socratic' } });
    const { id } = (await created.json()) as { id: string };

    // Student of school B (seed.b) is activated so only the school boundary can block them.
    await activateStudent(seed.b.student);
    const bName = await usernameOf(seed.b.student.userId!);
    const bCookie = await cookieFor(request, bName);

    const read = await request.get(`/api/tutor/conversations/${id}/messages`, { headers: { cookie: bCookie } });
    expect(read.status()).toBe(404);
    expect((await read.json()).error.code).toBe('NOT_FOUND');

    const fb = await request.post(`/api/tutor/messages/${NIL}/feedback`, { headers: { cookie: bCookie }, data: { rating: 'down' } });
    expect(fb.status()).toBe(404);

    // School A's subject id is not a valid subject for school B's new chat.
    const crossSubject = await request.post('/api/tutor/conversations', {
      headers: { cookie: bCookie }, data: { skillKey: 'socratic', subjectId: seed.a.subjectId },
    });
    expect(crossSubject.status()).toBe(400);
    expect((await crossSubject.json()).error.code).toBe('VALIDATION');

    const list = await request.get('/api/tutor/conversations', { headers: { cookie: bCookie } });
    const ids = ((await list.json()) as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(id);
  });

  test('malformed and unknown ids return 404 and an unknown skill is a validation error', async ({ request }) => {
    const cookie = await cookieFor(request, learnerName);

    const malformed = await request.get('/api/tutor/conversations/not-a-uuid/messages', { headers: { cookie } });
    expect(malformed.status()).toBe(404);
    expect((await malformed.json()).error.code).toBe('NOT_FOUND');

    const unknown = await request.get(`/api/tutor/conversations/${NIL}/messages`, { headers: { cookie } });
    expect(unknown.status()).toBe(404);

    const badSkill = await request.post('/api/tutor/conversations', { headers: { cookie }, data: { skillKey: 'no-such-skill' } });
    expect(badSkill.status()).toBe(400);
    expect((await badSkill.json()).error.code).toBe('VALIDATION');
  });

  test('a chat URL for an unknown conversation sends the student back to /learn', async ({ page }) => {
    await uiLogin(page, learnerName);
    await page.goto(`/learn/c/${NIL}`);
    await expect(page).toHaveURL(/\/learn$/);
  });

  test('signed-out API calls are 401 and the chat page sends the visitor to /login', async ({ page, request }) => {
    const list = await request.get('/api/tutor/conversations');
    expect(list.status()).toBe(401);
    expect((await list.json()).error.code).toBe('UNAUTHENTICATED');

    const send = await request.post(`/api/tutor/conversations/${NIL}/messages`, { data: { text: 'hi' } });
    expect(send.status()).toBe(401);

    await page.goto(`/learn/c/${NIL}`);
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('non-active students', () => {
  test('a pending student is sent to /status and cannot start a chat', async ({ page, request }) => {
    await uiLogin(page, pendingName);
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText(/waiting for activation/)).toBeVisible();

    await page.goto('/learn');
    await expect(page).toHaveURL(/\/status$/);

    const cookie = await cookieFor(request, pendingName);
    const create = await request.post('/api/tutor/conversations', { headers: { cookie }, data: { skillKey: 'socratic' } });
    expect(create.status()).toBe(403);
    expect((await create.json()).error.code).toBe('FORBIDDEN');
    const subjects = await request.get('/api/tutor/subjects', { headers: { cookie } });
    expect(subjects.status()).toBe(403);
  });

  test('a lapsed student is sent to /status with the renewal message and cannot open /learn', async ({ page }) => {
    await withPlatform((tx) =>
      tx.update(subscriptions)
        .set({ currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(subscriptions.studentId, seed.a.student.userId!)),
    );
    await uiLogin(page, learnerName);
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText('Your plan has expired. Please contact us to renew.')).toBeVisible();

    await page.goto('/learn');
    await expect(page).toHaveURL(/\/status$/);
  });
});

test.describe('mobile layout at 390px', () => {
  test.setTimeout(120_000);

  test('/learn fits the 390px width with no horizontal page scroll', async ({ page }) => {
    await uiLogin(page, learnerName);
    await expect(page).toHaveURL(/\/learn$/);
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByRole('button', { name: 'Start chat' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByRole('button', { name: 'Start chat' }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test('a chat with a long unbroken message keeps the page width and the composer usable', async ({ page }) => {
    await uiLogin(page, learnerName);
    await startChat(page, 'Socratic');
    const long = `Tell me about topic 1 in Chapter 1 ${'a'.repeat(400)}`;
    await sendMessage(page, long);
    await expect(page.getByText(/Let's work this out together/)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const textarea = page.getByLabel('Your message');
    await expect(textarea).toBeEditable();
    const tb = await textarea.boundingBox();
    expect(tb!.x).toBeGreaterThanOrEqual(0);
    expect(tb!.x + tb!.width).toBeLessThanOrEqual(390);

    // The composer is still usable after a reply: type and send another message.
    await textarea.fill('Second question after the reply');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Second question after the reply', { exact: true })).toBeVisible();
  });
});
