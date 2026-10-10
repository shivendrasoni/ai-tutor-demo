import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { conversations, messages, usageDaily, users } from '@/db/schema';
import { getMessages } from '@/modules/tutor';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';
import { activate, resetTutorFakes, scriptedModel, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

import * as loginRoute from '@/app/api/auth/login/route';
import * as convRoute from '@/app/api/tutor/conversations/route';
import * as msgsRoute from '@/app/api/tutor/conversations/[id]/messages/route';
import * as feedbackRoute from '@/app/api/tutor/messages/[id]/feedback/route';
import * as skillsRoute from '@/app/api/tutor/skills/route';

let seed: Seed;
let cookie: string;
let pendingCookie: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function loginCookie(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  const res = await loginRoute.POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: SEED_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}
const get = (path: string, c?: string) => new Request(`http://localhost${path}`, { headers: c ? { cookie: c } : {} });
const post = (path: string, body: unknown, c?: string, signal?: AbortSignal) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) },
    body: JSON.stringify(body),
    signal,
  });

async function readSse(res: Response): Promise<{ event: string; data: any }[]> {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const ev = /^event: (.*)$/m.exec(block)![1];
      const data = /^data: (.*)$/m.exec(block)![1];
      return { event: ev, data: JSON.parse(data) };
    });
}
async function newConv(c = cookie): Promise<string> {
  const res = await convRoute.POST(post('/api/tutor/conversations', { skillKey: 'socratic' }, c));
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await seedTutorSkills();
  await activate(seed.a.student);
  cookie = await loginCookie(seed.a.student.userId);
  pendingCookie = await loginCookie(seed.b.student.userId);
});
beforeEach(async () => {
  await withPlatform(async (tx) => {
    await tx.delete(usageDaily);
    await tx.delete(messages);
    await tx.delete(conversations);
  });
});
afterEach(() => resetTutorFakes());
afterAll(() => closeDb());

describe('tutor routes', () => {
  it('POST messages streams SSE events in order with the documented names', async () => {
    useTutorFakes();
    const id = await newConv();
    const res = await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'hi' }, cookie), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const events = await readSse(res);
    const n = events.filter((e) => e.event === 'delta').length;
    expect(n).toBeGreaterThan(1);
    expect(events.map((e) => e.event)).toEqual(['meta', ...Array(n).fill('delta'), 'citations', 'done']);
    expect(events[0].data).toMatchObject({ skill: 'socratic', modelTier: 'standard' });
  });

  it('budget exhausted: 429 JSON BUDGET_EXCEEDED (not a stream)', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1');
    const model = scriptedModel([{ text: 'a', usage: { in: 10, out: 5 } }]);
    useTutorFakes({ model });
    const id = await newConv();
    await readSse(await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'one' }, cookie), ctx(id)));
    const res = await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'two' }, cookie), ctx(id));
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ error: { code: 'BUDGET_EXCEEDED', message: expect.any(String) } });
  });

  it('provider failure: 200 stream ending in an error TUTOR_BUSY event', async () => {
    useTutorFakes({ model: scriptedModel([{ error: new Error('boom') }]) });
    const id = await newConv();
    const res = await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'hi' }, cookie), ctx(id));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'TUTOR_BUSY' } });
  });

  it('auth and validation errors', async () => {
    useTutorFakes();
    const id = await newConv();
    const url = `/api/tutor/conversations/${id}/messages`;
    expect((await msgsRoute.POST(post(url, { text: 'hi' }), ctx(id))).status).toBe(401);
    expect((await msgsRoute.POST(post(url, { text: 'hi' }, pendingCookie), ctx(id))).status).toBe(403);
    await activate(seed.b.student);
    expect((await msgsRoute.POST(post(url, { text: 'hi' }, pendingCookie), ctx(id))).status).toBe(404);
    expect((await msgsRoute.POST(post(url, { text: 'x'.repeat(4001) }, cookie), ctx(id))).status).toBe(400);
    expect((await msgsRoute.POST(post(url, { text: '   ' }, cookie), ctx(id))).status).toBe(400);
    expect((await msgsRoute.POST(post('/api/tutor/conversations/nope/messages', { text: 'hi' }, cookie), ctx('nope'))).status).toBe(404);
    expect((await msgsRoute.GET(get('/api/tutor/conversations/nope/messages', cookie), ctx('nope'))).status).toBe(404);
    expect((await feedbackRoute.POST(post('/api/tutor/messages/nope/feedback', { rating: 'down' }, cookie), ctx('nope'))).status).toBe(404);
  });

  it('conversation create/list/messages/feedback round trip; skills omit instructions', async () => {
    useTutorFakes();
    const id = await newConv();
    await readSse(await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'hello there' }, cookie), ctx(id)));
    const list = await (await convRoute.GET(get('/api/tutor/conversations', cookie))).json();
    expect(list).toEqual([expect.objectContaining({ id, title: 'hello there', skillKey: 'socratic' })]);
    const msgs = await (await msgsRoute.GET(get(`/api/tutor/conversations/${id}/messages`, cookie), ctx(id))).json();
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    const fb = await feedbackRoute.POST(post(`/api/tutor/messages/${msgs[1].id}/feedback`, { rating: 'down', comment: 'wrong' }, cookie), ctx(msgs[1].id));
    expect(fb.status).toBe(204);
    expect((await getMessages(seed.a.student, id))[1]).toMatchObject({ flagged: true, flagReason: 'student_feedback' });
    expect((await feedbackRoute.POST(post(`/api/tutor/messages/${msgs[1].id}/feedback`, { rating: 'up' }, cookie), ctx(msgs[1].id))).status).toBe(400);

    const skills = await (await skillsRoute.GET(get('/api/tutor/skills?kind=chat', cookie))).json();
    expect(skills.map((s: { key: string }) => s.key).sort()).toEqual(['explain', 'socratic']);
    for (const s of skills) {
      expect(s).not.toHaveProperty('instructions');
      expect(s).not.toHaveProperty('models');
      expect(s).not.toHaveProperty('providerOptions');
    }
    expect((await skillsRoute.GET(get('/api/tutor/skills?kind=bogus', cookie))).status).toBe(400);
    expect((await skillsRoute.GET(get('/api/tutor/skills'))).status).toBe(401);
  });

  it('cancelling the response body persists the partial assistant message', async () => {
    useTutorFakes({ model: scriptedModel([{ text: 'Plants make food from sunlight and water.' }]) });
    const id = await newConv();
    const ac = new AbortController();
    const res = await msgsRoute.POST(post(`/api/tutor/conversations/${id}/messages`, { text: 'hi' }, cookie, ac.signal), ctx(id));
    const reader = res.body!.getReader();
    await reader.read(); // meta
    await reader.read(); // first delta
    await reader.cancel();
    await vi.waitFor(async () => {
      const m = await getMessages(seed.a.student, id);
      expect(m.map((x) => x.role)).toEqual(['user', 'assistant']);
      expect(m[1].content.length).toBeGreaterThan(0);
      expect(m[1].decisions).toMatchObject({ aborted: true });
    });
  });
});
