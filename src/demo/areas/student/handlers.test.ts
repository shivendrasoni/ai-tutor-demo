import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, dispatch, registerRoutes } from '../../core/router';
import { initStore, setPersona } from '../../core/store';
import { coreSeed } from '../../core/seed-core';
import { parseSseChunks } from '@/lib/sse-client';
import { buildSeed } from './fixtures';
import { routes } from './handlers';
import { CURRICULUM } from './curriculum';

const u = (p: string) => new URL(p, 'http://localhost');
const call = async (method: string, path: string, body?: unknown) => {
  const res = await dispatch(method, u(path), body === undefined ? undefined : { body: JSON.stringify(body) });
  return { res, json: async () => res.json() };
};
const get = async (path: string) => (await (await call('GET', path)).res.json());

beforeEach(() => {
  clearRoutes();
  registerRoutes(routes);
  initStore({ core: coreSeed, student: buildSeed() });
  setPersona('student_middle'); // Diya, grade 7
});

describe('student demo: seed and isolation', () => {
  it('has realistic per-student conversations', async () => {
    const diya = await get('/api/tutor/conversations');
    expect(diya.length).toBeGreaterThanOrEqual(3);
    expect(diya[0].title).toBeTruthy();
    setPersona('student_junior');
    const aarav = await get('/api/tutor/conversations');
    expect(aarav.map((c: { id: string }) => c.id)).not.toEqual(diya.map((c: { id: string }) => c.id));
    const msgs = await get(`/api/tutor/conversations/${aarav[0].id}/messages`);
    expect(msgs[0].role).toBe('user');
    expect(msgs.some((m: { citations: unknown[] }) => m.citations.length > 0)).toBe(true);
  });
  it("404s on another student's conversation and 403s for non-students", async () => {
    const mine = await get('/api/tutor/conversations');
    setPersona('student_senior');
    expect((await call('GET', `/api/tutor/conversations/${mine[0].id}/messages`)).res.status).toBe(404);
    setPersona('teacher');
    expect((await call('GET', '/api/tutor/conversations')).res.status).toBe(403);
    setPersona('student_pending');
    expect((await call('GET', '/api/tutor/subjects')).res.status).toBe(403);
  });
  it('lists subjects, skills, chapters and patterns by grade', async () => {
    expect((await get('/api/tutor/subjects')).length).toBe(4);
    expect((await get('/api/tutor/skills?kind=chat')).map((s: { key: string }) => s.key)).toEqual(['socratic', 'explain']);
    const ch = await get('/api/study/chapters?subjectId=sub-math');
    expect(ch[0].title).toBe(CURRICULUM.middle['sub-math'][0]!.title);
    expect((await get('/api/study/patterns')).map((p: { key: string }) => p.key)).toEqual(['half_yearly_45']);
  });
});

describe('student demo: chat', () => {
  it('creates a conversation and streams a scripted Socratic reply that persists', async () => {
    const { json } = await call('POST', '/api/tutor/conversations', { skillKey: 'socratic', subjectId: 'sub-math' });
    const { id } = await json();
    const res = (await call('POST', `/api/tutor/conversations/${id}/messages`, { text: 'Can you explain fractions to me?' })).res;
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const { events } = parseSseChunks(await res.text());
    expect(events[0]!.event).toBe('meta');
    expect(events.filter((e) => e.event === 'delta').length).toBeGreaterThan(10);
    expect(events.some((e) => e.event === 'citations')).toBe(true);
    expect(events.at(-1)!.event).toBe('done');
    const msgs = await get(`/api/tutor/conversations/${id}/messages`);
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toMatch(/\?/);
    expect(msgs[1].id).toBe((events[0]!.data as { messageId: string }).messageId);
    const list = await get('/api/tutor/conversations');
    expect(list.find((c: { id: string }) => c.id === id).title).toBe('Can you explain fractions to me?');
  });
  it('varies by keyword and follows up on the same topic', async () => {
    const { id } = await (await call('POST', '/api/tutor/conversations', { skillKey: 'socratic' })).json();
    const say = async (text: string) => {
      await (await call('POST', `/api/tutor/conversations/${id}/messages`, { text })).res.text();
      const m = await get(`/api/tutor/conversations/${id}/messages`);
      return m.at(-1).content as string;
    };
    const a = await say('how do I solve 2x + 3 = 9');
    const b = await say('what is photosynthesis');
    expect(a).not.toEqual(b);
    const c = await say('maybe the plant uses sunlight');
    expect(c).toMatch(/sunlight|raw materials|water/i);
  });
  it('rejects empty messages and records thumbs-down feedback', async () => {
    const [c] = await get('/api/tutor/conversations');
    expect((await call('POST', `/api/tutor/conversations/${c.id}/messages`, { text: '  ' })).res.status).toBe(400);
    const msgs = await get(`/api/tutor/conversations/${c.id}/messages`);
    const a = msgs.find((m: { role: string }) => m.role === 'assistant');
    expect((await call('POST', `/api/tutor/messages/${a.id}/feedback`, { rating: 'down' })).res.status).toBe(204);
    expect((await get(`/api/tutor/conversations/${c.id}/messages`)).find((m: { id: string }) => m.id === a.id).feedback).toBe('down');
  });
});

describe('student demo: study tools', () => {
  it('lists seeded items per type with best score', async () => {
    const tests = await get('/api/study/artifacts?type=practice_test');
    expect(tests.length).toBeGreaterThanOrEqual(2);
    expect(tests[0].status).toBe('ready');
    expect(tests.some((t: { bestScorePct: number | null }) => t.bestScorePct !== null)).toBe(true);
    expect((await get('/api/study/artifacts?type=study_notes'))[0].type).toBe('study_notes');
  });
  it('generates an artifact that is generating first, then ready', async () => {
    const ch = await get('/api/study/chapters?subjectId=sub-sci');
    const { id } = await (await call('POST', '/api/study/artifacts', { type: 'study_notes', subjectId: 'sub-sci', chapterIds: [ch[0].id, ch[1].id] })).json();
    expect((await get(`/api/study/artifacts/${id}`)).status).toBe('generating');
    const list = await get('/api/study/artifacts?type=study_notes');
    expect(list.find((a: { id: string }) => a.id === id).status).toBe('generating');
    const real = Date.now;
    Date.now = () => real() + 10_000;
    try {
      const a = await get(`/api/study/artifacts/${id}`);
      expect(a.status).toBe('ready');
      expect(a.notes.length).toBe(6);
      expect(a.notes[0].citations[0].itemTitle).toBeTruthy();
    } finally {
      Date.now = real;
    }
  });
  it('validates artifact requests', async () => {
    const ch = await get('/api/study/chapters?subjectId=sub-sci');
    expect((await call('POST', '/api/study/artifacts', { type: 'practice_test', subjectId: 'sub-sci', chapterIds: [] })).res.status).toBe(400);
    expect((await call('POST', '/api/study/artifacts', { type: 'practice_test', subjectId: 'sub-math', chapterIds: [ch[0].id] })).res.status).toBe(400);
    expect((await call('POST', '/api/study/artifacts', { type: 'practice_test', subjectId: 'sub-sci', chapterIds: [ch[0].id], questionCount: 2 })).res.status).toBe(400);
  });
  it('runs a full test: start, resume, save, submit, score and review', async () => {
    const real = Date.now;
    const ch = await get('/api/study/chapters?subjectId=sub-math');
    const { id } = await (await call('POST', '/api/study/artifacts', { type: 'practice_test', subjectId: 'sub-math', chapterIds: [ch[0].id, ch[1].id], questionCount: 8 })).json();
    expect((await call('POST', `/api/study/artifacts/${id}/attempts`)).res.status).toBe(400); // still generating
    Date.now = () => real() + 10_000;
    try {
      const art = await get(`/api/study/artifacts/${id}`);
      expect(art.questions.length).toBe(8);
      expect(art.questions[0].correctIndex).toBeUndefined();
      const start = await (await call('POST', `/api/study/artifacts/${id}/attempts`)).json();
      expect(start.deadline).toBeNull();
      const again = await (await call('POST', `/api/study/artifacts/${id}/attempts`)).json();
      expect(again.attemptId).toBe(start.attemptId);

      const mcqs = art.questions.filter((q: { type: string }) => q.type === 'mcq');
      const answers: Record<string, number | string> = {};
      // Answer the first MCQ with index 0 and leave the rest blank.
      answers[mcqs[0].id] = 0;
      expect((await call('PUT', `/api/study/attempts/${start.attemptId}/answers`, { answers })).res.status).toBe(204);
      expect((await call('PUT', `/api/study/attempts/${start.attemptId}/answers`, { answers: { nope: 1 } })).res.status).toBe(400);
      const resumed = await (await call('POST', `/api/study/artifacts/${id}/attempts`)).json();
      expect(resumed.answers).toEqual(answers);

      const shorts = art.questions.filter((q: { type: string }) => q.type === 'short');
      answers[shorts[0].id] = 'The bottom number tells how many equal parts the whole is divided into.';
      await call('PUT', `/api/study/attempts/${start.attemptId}/answers`, { answers });
      const sub = await (await call('POST', `/api/study/attempts/${start.attemptId}/submit`)).json();
      expect(sub.status).toBe('grading');
      let at = await get(`/api/study/attempts/${start.attemptId}`);
      expect(at.status).toBe('grading');
      expect(at.questions.length).toBe(8);
      Date.now = () => real() + 20_000;
      at = await get(`/api/study/attempts/${start.attemptId}`);
      expect(at.status).toBe('graded');
      expect(at.maxScore).toBe(art.questions.reduce((s: number, q: { marks: number }) => s + q.marks, 0));
      expect(at.score).toBeGreaterThanOrEqual(0);
      expect(Object.keys(at.byChapter).length).toBeGreaterThan(0);
      expect(at.questions.find((q: { type: string }) => q.type === 'mcq').correctIndex).toBeTypeOf('number');
      const shortRes = at.results[shorts[0].id];
      expect(shortRes.feedback).toBeTruthy();
      expect((await call('PUT', `/api/study/attempts/${start.attemptId}/answers`, { answers })).res.status).toBe(400);
      const detail = await get(`/api/study/artifacts/${id}`);
      expect(detail.attempts[0].status).toBe('graded');
    } finally {
      Date.now = real;
    }
  });
  it('gives mock exams a deadline and rejects saves after it plus grace', async () => {
    const real = Date.now;
    const seeded = (await get('/api/study/artifacts?type=mock_exam'))[0];
    const art = await get(`/api/study/artifacts/${seeded.id}`);
    expect(art.sections.length).toBe(2);
    const start = await (await call('POST', `/api/study/artifacts/${seeded.id}/attempts`)).json();
    expect(Date.parse(start.deadline) - Date.parse(start.startedAt)).toBe(art.durationMinutes * 60_000);
    Date.now = () => real() + (art.durationMinutes + 3) * 60_000;
    try {
      const r = await call('PUT', `/api/study/attempts/${start.attemptId}/answers`, { answers: {} });
      expect(r.res.status).toBe(409);
      expect((await r.json()).error.code).toBe('ATTEMPT_EXPIRED');
      const at = await get(`/api/study/attempts/${start.attemptId}`);
      expect(at.status).toBe('graded');
      expect(at.submittedAt).toBe(start.deadline);
    } finally {
      Date.now = real;
    }
  });
  it('shows a seeded graded attempt with review data', async () => {
    const [t] = (await get('/api/study/artifacts?type=practice_test')).filter((a: { attemptCount: number }) => a.attemptCount > 0);
    const detail = await get(`/api/study/artifacts/${t.id}`);
    const at = await get(`/api/study/attempts/${detail.attempts[0].id}`);
    expect(at.status).toBe('graded');
    expect(at.score).toBeGreaterThan(0);
    expect(at.score).toBeLessThanOrEqual(at.maxScore);
  });
});
