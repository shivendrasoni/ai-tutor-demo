import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTake } from '@/app/(student)/learn/study/_lib/start';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const art = { id: 'a1', type: 'practice_test', status: 'ready', questions: [] };

afterEach(() => vi.unstubAllGlobals());

function stub(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls.push(key);
    const r = routes[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return r();
  });
  return calls;
}

describe('startTake', () => {
  it('uses the answers returned by the start call (no second GET)', async () => {
    const calls = stub({
      'GET /api/study/artifacts/a1': () => json(200, art),
      'POST /api/study/artifacts/a1/attempts': () => json(201, { attemptId: 't1', deadline: null, answers: { q0: 2 } }),
    });
    const r = await startTake('a1');
    expect(r).toMatchObject({ ok: true, attemptId: 't1', answers: { q0: 2 } });
    expect(calls).toEqual(['GET /api/study/artifacts/a1', 'POST /api/study/artifacts/a1/attempts']);
  });

  it.each([
    ['start fails', { start: 500, art: 200 }],
    ['artifact load fails', { start: 201, art: 500 }],
  ])('%s: fatal, no attempt id (so nothing can be autosaved over saved answers)', async (_n, st) => {
    const calls = stub({
      'GET /api/study/artifacts/a1': () => json(st.art, st.art === 200 ? art : { error: { code: 'INTERNAL' } }),
      'POST /api/study/artifacts/a1/attempts': () => json(st.start, st.start === 201 ? { attemptId: 't1', deadline: null, answers: {} } : { error: { code: 'INTERNAL' } }),
    });
    const r = await startTake('a1');
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('attemptId');
    expect(calls.some((c) => c.startsWith('PUT'))).toBe(false);
  });
});
