import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { artifacts, attempts, studentProfiles, users } from '@/db/schema';
import { handleGenerateJob } from '@/modules/studytools';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { setNow } from '@/modules/studytools/clock';
import { getPattern } from '@/modules/studytools/patterns';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';
import {
  activateStudent, insertArtifact, mockFor, mockModel, practice, resetStudyMocks, seedStudyContent, useMockModels,
  useRecordingQueue,
} from '../helpers/study';

import * as loginRoute from '@/app/api/auth/login/route';
import * as patternsRoute from '@/app/api/study/patterns/route';
import * as artifactsRoute from '@/app/api/study/artifacts/route';
import * as artifactRoute from '@/app/api/study/artifacts/[id]/route';
import * as startRoute from '@/app/api/study/artifacts/[id]/attempts/route';
import * as answersRoute from '@/app/api/study/attempts/[id]/answers/route';
import * as submitRoute from '@/app/api/study/attempts/[id]/submit/route';
import * as attemptRoute from '@/app/api/study/attempts/[id]/route';
import * as progressRoute from '@/app/api/study/progress/route';

let seed: Seed;
let ids: { subjectId: string; chapterIds: string[]; chunkIds: string[] };
let cookie: string;
let pendingCookie: string;
let otherCookie: string;
let teacherCookie: string;
let practiceId: string;
let mockId: string;
const rec = useRecordingQueue();

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, path: string, c?: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(c ? { cookie: c } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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

const withChunks = <T extends { questions: object[] }>(c: T) => ({ ...c, questions: c.questions.map((q) => ({ ...q, chunkIds: [] })), sources: {} });
const createBody = () => ({ type: 'practice_test', subjectId: ids.subjectId, chapterIds: ids.chapterIds.slice(0, 2), questionCount: 5 });

const validPracticeJson = () => {
  const t = practice(5);
  t.questions.forEach((q, i) => {
    q.chapterId = ids.chapterIds[i % 2]!;
    q.passageRefs = [`P${(i % 3) + 1}`];
  });
  return t;
};

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await activateStudent(seed.b.student);
  await seedSkills(STUDY_SKILLS);
  ids = await seedStudyContent(seed.a);
  cookie = await loginCookie(seed.a.student.userId!);
  otherCookie = await loginCookie(seed.b.student.userId!);
  teacherCookie = await loginCookie(seed.a.teacher.userId!);
  const mine = (over: Record<string, unknown>) => insertArtifact(seed.a.schoolId, seed.a.student.userId!, ids.subjectId, over as never);
  practiceId = (await mine({ content: withChunks(practice(8)) })).id;
  const mock = mockFor((await getPattern('junior_50'))!);
  mockId = (await mine({
    type: 'mock_exam',
    content: { ...mock, sections: mock.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, chunkIds: [] })) })), sources: {} },
  })).id;
});
afterEach(async () => {
  setNow(null);
  resetStudyMocks();
  await withPlatform((tx) => tx.delete(attempts));
});
afterAll(() => closeDb());

const startAttempt = async (id = practiceId, c = cookie) => (await (await startRoute.POST(req('POST', `/x`, c), ctx(id))).json()).attemptId as string;

describe('study routes', () => {
  it('POST artifacts → 201 and GET polls generating → ready after the job runs, with no answer keys', async () => {
    const res = await artifactsRoute.POST(req('POST', '/api/study/artifacts', cookie, createBody()));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const poll = async () => (await artifactRoute.GET(req('GET', `/api/study/artifacts/${id}`, cookie), ctx(id))).json();
    expect((await poll()).status).toBe('generating');
    useMockModels({ standard: mockModel([validPracticeJson()]) });
    await handleGenerateJob({ data: rec.current.generate[0]! });
    const view = await poll();
    expect(view.status).toBe('ready');
    expect(JSON.stringify(view)).not.toMatch(/correctIndex|modelAnswer|rubric/);
    const list = await (await artifactsRoute.GET(req('GET', '/api/study/artifacts?type=practice_test', cookie))).json();
    expect(list.some((a: { id: string }) => a.id === id)).toBe(true);
  });

  it('maps GENERATION_LIMIT → 429 and ATTEMPT_EXPIRED → 409 with error bodies', async () => {
    await withPlatform((tx) => tx.delete(artifacts).where(eq(artifacts.studentId, seed.a.student.userId!)));
    practiceId = (await insertArtifact(seed.a.schoolId, seed.a.student.userId!, ids.subjectId, { content: withChunks(practice(8)) } as never)).id;
    const mock = mockFor((await getPattern('junior_50'))!);
    mockId = (await insertArtifact(seed.a.schoolId, seed.a.student.userId!, ids.subjectId, {
      type: 'mock_exam',
      content: { ...mock, sections: mock.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, chunkIds: [] })) })), sources: {} },
    } as never)).id;
    // 2 fixtures already count today; 8 more reach 10
    for (let i = 0; i < 8; i++) {
      expect((await artifactsRoute.POST(req('POST', '/api/study/artifacts', cookie, createBody()))).status).toBe(201);
    }
    const over = await artifactsRoute.POST(req('POST', '/api/study/artifacts', cookie, createBody()));
    expect(over.status).toBe(429);
    expect((await over.json()).error.code).toBe('GENERATION_LIMIT');

    const T0 = new Date();
    setNow(() => T0);
    const attemptId = await startAttempt(mockId);
    setNow(() => new Date(T0.getTime() + 200 * 60_000));
    const late = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: {} }), ctx(attemptId));
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe('ATTEMPT_EXPIRED');
  });

  it('PUT answers with MCQ index 9 → 400 VALIDATION; a valid save → 204', async () => {
    const attemptId = await startAttempt();
    const bad = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: { q0: 9 } }), ctx(attemptId));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION');
    const shape = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: [1] }), ctx(attemptId));
    expect(shape.status).toBe(400);
    const ok = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: { q0: 1, q6: 'text' } }), ctx(attemptId));
    expect(ok.status).toBe(204);
  });

  it('accepts a body above the default 100 KB cap for answers', async () => {
    const attemptId = await startAttempt(mockId);
    const big = 'x'.repeat(10_000);
    // junior_50 has 10 short (B) + 4 long (C) questions: 14 answers of 10000 chars is ~140 KB
    const keys = [...Array.from({ length: 10 }, (_, i) => `B${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `C${i + 1}`)];
    const res = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: Object.fromEntries(keys.map((k) => [k, big])) }), ctx(attemptId));
    expect(res.status).toBe(204);
    const huge = await answersRoute.PUT(req('PUT', '/x', cookie, { answers: { q6: 'y'.repeat(450 * 1024) } }), ctx(attemptId));
    expect(huge.status).toBe(400);
  });

  it('unauthenticated → 401; pending student → 403; other student attempt → 404', async () => {
    expect((await artifactsRoute.GET(req('GET', '/api/study/artifacts'))).status).toBe(401);
    expect((await patternsRoute.GET(req('GET', '/api/study/patterns'))).status).toBe(401);
    const attemptId = await startAttempt();
    expect((await attemptRoute.GET(req('GET', '/x', otherCookie), ctx(attemptId))).status).toBe(404);
    expect((await submitRoute.POST(req('POST', '/x', otherCookie), ctx(attemptId))).status).toBe(404);
    expect((await answersRoute.PUT(req('PUT', '/x', otherCookie, { answers: {} }), ctx(attemptId))).status).toBe(404);
    expect((await artifactRoute.GET(req('GET', '/x', otherCookie), ctx(practiceId))).status).toBe(404);
  });

  it('pending student → 403', async () => {
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'pending_payment' }).where(eq(studentProfiles.userId, seed.b.student.userId!)));
    try {
      pendingCookie = await loginCookie(seed.b.student.userId!);
      expect((await artifactsRoute.POST(req('POST', '/x', pendingCookie, createBody()))).status).toBe(403);
      expect((await patternsRoute.GET(req('GET', '/x', pendingCookie))).status).toBe(403);
    } finally {
      await activateStudent(seed.b.student);
    }
  });

  it('submit twice returns 200 both times', async () => {
    const attemptId = await startAttempt();
    const a = await submitRoute.POST(req('POST', '/x', cookie), ctx(attemptId));
    const b = await submitRoute.POST(req('POST', '/x', cookie), ctx(attemptId));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(['grading', 'graded']).toContain((await b.json()).status);
  });

  it('GET attempt before submit has no keys; after submit has them', async () => {
    const attemptId = await startAttempt();
    const before = await (await attemptRoute.GET(req('GET', '/x', cookie), ctx(attemptId))).json();
    expect(JSON.stringify(before)).not.toMatch(/correctIndex|modelAnswer|rubric/);
    await submitRoute.POST(req('POST', '/x', cookie), ctx(attemptId));
    const after = await (await attemptRoute.GET(req('GET', '/x', cookie), ctx(attemptId))).json();
    expect(JSON.stringify(after)).toMatch(/correctIndex/);
  });

  it('progress as teacher is scoped; as student is own', async () => {
    const attemptId = await startAttempt();
    await withPlatform((tx) =>
      tx.update(attempts).set({ status: 'graded', submittedAt: new Date(), byChapter: { c1: { scored: 3, max: 4 } } }).where(eq(attempts.id, attemptId)),
    );
    const mineRows = await (await progressRoute.GET(req('GET', '/api/study/progress', cookie))).json();
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0]).toMatchObject({ studentId: seed.a.student.userId, scored: 3, max: 4 });
    const t = await (await progressRoute.GET(req('GET', `/api/study/progress?subjectId=${ids.subjectId}&studentIds=${seed.a.student.userId}`, teacherCookie))).json();
    expect(t).toHaveLength(1);
    const none = await (await progressRoute.GET(req('GET', `/api/study/progress?studentIds=${seed.b.student.userId}`, teacherCookie))).json();
    expect(none).toEqual([]);
    expect((await progressRoute.GET(req('GET', '/api/study/progress?subjectId=nope', cookie))).status).toBe(400);
  });

  it('patterns: student gets their grade; staff get all', async () => {
    const s = await (await patternsRoute.GET(req('GET', '/x', cookie))).json();
    expect(s.map((p: { key: string }) => p.key)).toEqual(['junior_50']);
    const t = await (await patternsRoute.GET(req('GET', '/x', teacherCookie))).json();
    expect(t.map((p: { key: string }) => p.key)).toEqual(['junior_50', 'standard_80']);
  });

  it('malformed UUID in path → 404, never 500; bad body/query → 400', async () => {
    for (const call of [
      () => artifactRoute.GET(req('GET', '/x', cookie), ctx('nope')),
      () => startRoute.POST(req('POST', '/x', cookie), ctx('nope')),
      () => attemptRoute.GET(req('GET', '/x', cookie), ctx('nope')),
      () => submitRoute.POST(req('POST', '/x', cookie), ctx('nope')),
      () => answersRoute.PUT(req('PUT', '/x', cookie, { answers: {} }), ctx('nope')),
    ]) {
      expect((await call()).status).toBe(404);
    }
    expect((await artifactsRoute.POST(req('POST', '/x', cookie, { ...createBody(), chapterIds: ['nope'] }))).status).toBe(400);
    expect((await artifactsRoute.POST(req('POST', '/x', cookie, { ...createBody(), questionCount: 99 }))).status).toBe(400);
    expect((await artifactsRoute.GET(req('GET', '/api/study/artifacts?type=bogus', cookie))).status).toBe(400);
  });

  it('GET artifact includes the student\'s attempts (newest first) and no answer keys', async () => {
    const id = await startAttempt();
    const view = await (await artifactRoute.GET(req('GET', `/api/study/artifacts/${practiceId}`, cookie), ctx(practiceId))).json();
    expect(view.attempts[0]).toMatchObject({ id, status: 'in_progress', submittedAt: null, score: null });
    expect(JSON.stringify(view)).not.toMatch(/correctIndex|modelAnswer|rubric/);
    const other = await artifactRoute.GET(req('GET', `/api/study/artifacts/${practiceId}`, otherCookie), ctx(practiceId));
    expect(other.status).toBe(404);
  });
});
