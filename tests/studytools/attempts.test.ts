import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import { getArtifact } from '@/modules/studytools/artifacts';
import { getAttempt, saveAnswers, startAttempt, submitAttempt } from '@/modules/studytools/attempts';
import { setNow } from '@/modules/studytools/clock';
import { getPattern } from '@/modules/studytools/patterns';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, CH, insertArtifact, mockFor, practice, useRecordingQueue } from '../helpers/study';
import type { Actor } from '@/modules/tenancy/actor';

const T0 = new Date('2026-10-10T10:00:00Z');
const GRACE = 2 * 60_000;
let seed: Seed;
let student: Actor;
let subjectId: string;
let practiceId: string;
let mockId: string;
let notesId: string;
const rec = useRecordingQueue();

// 6 MCQ (q0..q5, correctIndex 1, ch CH) + 2 short (q6, q7)
const withChunks = <T extends { questions: object[] }>(c: T) => ({ ...c, questions: c.questions.map((q) => ({ ...q, chunkIds: [] })), sources: {} });

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await activateStudent(seed.b.student);
  student = seed.a.student;
  subjectId = seed.a.subjectId;
  const mine = (over: Record<string, unknown>) => insertArtifact(seed.a.schoolId, student.userId!, subjectId, over as never);
  practiceId = (await mine({ content: withChunks(practice(8)) })).id;
  const mock = mockFor((await getPattern('junior_50'))!);
  mockId = (await mine({
    type: 'mock_exam',
    content: { ...mock, sections: mock.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, chunkIds: [] })) })), sources: {} },
  })).id;
  notesId = (await mine({ type: 'study_notes', content: { title: 'N', sections: [], sources: {} } })).id;
});
afterEach(async () => {
  setNow(null);
  await withPlatform((tx) => tx.delete(attempts));
});

const start = async (id = practiceId) => (await startAttempt(student, id)).attemptId;
const rowOf = async (id: string) => (await withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.id, id))))[0]!;

describe('startAttempt', () => {
  it('notes → VALIDATION; non-ready → VALIDATION; others artifact → NOT_FOUND', async () => {
    await expect(startAttempt(student, notesId)).rejects.toMatchObject({ code: 'VALIDATION' });
    const gen = await insertArtifact(seed.a.schoolId, student.userId!, subjectId, { status: 'generating', content: null });
    await expect(startAttempt(student, gen.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(startAttempt(seed.b.student, practiceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(startAttempt(student, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('practice test has no deadline; mock exam deadline = start + duration', async () => {
    setNow(() => T0);
    expect((await startAttempt(student, practiceId)).deadline).toBeNull();
    const m = await startAttempt(student, mockId);
    expect(m.startedAt).toEqual(T0);
    expect(m.deadline).toEqual(new Date(T0.getTime() + 120 * 60_000));
  });
  it('resumes the existing in-progress attempt with the same startedAt and deadline', async () => {
    setNow(() => T0);
    const a = await startAttempt(student, mockId);
    setNow(() => new Date(T0.getTime() + 60_000));
    const b = await startAttempt(student, mockId);
    expect(b).toEqual(a);
    expect(await withPlatform((tx) => tx.select().from(attempts))).toHaveLength(1);
  });
  it('a new attempt is allowed once the previous one is submitted', async () => {
    const a = await start();
    await submitAttempt(student, a);
    const b = await start();
    expect(a).not.toBe(b);
  });
  it('an expired in-progress attempt does not block a new one', async () => {
    setNow(() => T0);
    const a = await startAttempt(student, mockId);
    setNow(() => new Date(T0.getTime() + 120 * 60_000 + GRACE + 1000));
    const b = await startAttempt(student, mockId);
    expect(b.attemptId).not.toBe(a.attemptId);
  });
  it('getArtifact lists own attempts newest first without answer keys', async () => {
    setNow(() => T0);
    const a = await start();
    await submitAttempt(student, a);
    setNow(() => new Date(T0.getTime() + 1000));
    const b = await start();
    const view = await getArtifact(student, practiceId);
    expect(view.attempts.map((x) => x.id)).toEqual([b, a]);
    expect(view.attempts[1]).toMatchObject({ status: expect.any(String), score: expect.anything(), maxScore: expect.anything() });
    expect(JSON.stringify(view)).not.toMatch(/correctIndex|modelAnswer|rubric|answers/);
  });
});

describe('saveAnswers', () => {
  it.each([
    ['unknown question id', () => ({ nope: 1 })],
    ['mcq index 4', () => ({ q0: 4 })],
    ['mcq index -1', () => ({ q0: -1 })],
    ['mcq 1.5', () => ({ q0: 1.5 })],
    ['mcq string', () => ({ q0: '2' })],
    ['short as number', () => ({ q6: 3 })],
    ['short too long', () => ({ q6: 'x'.repeat(10001) })],
    ['one bad among good', () => ({ q0: 1, q6: 3 })],
    ['not an object', () => [1] as never],
  ])('rejects %s with VALIDATION and saves nothing', async (_n, make) => {
    const id = await start();
    await expect(saveAnswers(student, id, make() as never)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await getAttempt(student, id)).answers).toEqual({});
  });
  it('replaces the map (autosave semantics)', async () => {
    const id = await start();
    await saveAnswers(student, id, { q0: 1, q6: 'abc' });
    await saveAnswers(student, id, { q1: 2 });
    expect((await getAttempt(student, id)).answers).toEqual({ q1: 2 });
  });
  it('after submit → VALIDATION', async () => {
    const id = await start();
    await submitAttempt(student, id);
    await expect(saveAnswers(student, id, { q0: 1 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('expiry: within grace ok, one ms past → ATTEMPT_EXPIRED for save and submit', async () => {
    setNow(() => T0);
    const a = await start(mockId);
    // resume means start() returns the same attempt, so insert the second one directly
    const [row] = await withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.id, a)));
    const [{ id: b }] = await withPlatform((tx) =>
      tx.insert(attempts).values({ schoolId: row!.schoolId, artifactId: mockId, studentId: student.userId!, status: 'in_progress', startedAt: T0, answers: {} }).returning({ id: attempts.id }),
    );
    const edge = T0.getTime() + 120 * 60_000 + GRACE;
    setNow(() => new Date(edge));
    await expect(saveAnswers(student, a, { A1: 1 })).resolves.toBeUndefined();
    await expect(submitAttempt(student, a)).resolves.toBeDefined();
    setNow(() => new Date(edge + 1));
    await expect(saveAnswers(student, b, { A1: 1 })).rejects.toMatchObject({ code: 'ATTEMPT_EXPIRED' });
    await expect(submitAttempt(student, b)).rejects.toMatchObject({ code: 'ATTEMPT_EXPIRED' });
    expect((await rowOf(b)).status).toBe('in_progress');
  });
});

describe('submitAttempt', () => {
  it('MCQ-only test finalizes immediately as graded with exact score and by_chapter', async () => {
    const mcqOnly = (await insertArtifact(seed.a.schoolId, student.userId!, subjectId, { content: withChunks({ ...practice(6), questions: practice(6).questions.map((q, i) => ({ ...q, type: 'mcq', options: ['a', 'b', 'c', 'd'], correctIndex: 1, id: `q${i}`, marks: 1 })) }) })).id;
    const id = await start(mcqOnly);
    await saveAnswers(student, id, { q0: 1, q1: 0 });
    expect(await submitAttempt(student, id)).toEqual({ status: 'graded' });
    expect(await getAttempt(student, id)).toMatchObject({ score: 1, maxScore: 6, status: 'graded', byChapter: { [CH]: { scored: 1, max: 6 } } });
    expect(rec.current.grade).toHaveLength(0);
  });
  it('mixed test: status grading, MCQ scored, one job per ANSWERED subjective only', async () => {
    const id = await start();
    await saveAnswers(student, id, { q0: 1, q6: 'my answer', q7: '   ' });
    expect(await submitAttempt(student, id)).toEqual({ status: 'grading' });
    expect(rec.current.grade).toEqual([{ attemptId: id, schoolId: seed.a.schoolId, questionId: 'q6' }]);
    const r = (await rowOf(id)).results as Record<string, { score: number }>;
    expect(r.q0).toMatchObject({ score: 1, correct: true });
    expect(r.q7).toMatchObject({ score: 0, maxScore: 2 });
    expect(r.q6).toBeUndefined();
    expect((await rowOf(id)).submittedAt).not.toBeNull();
  });
  it('is idempotent: second submit returns current status, no more jobs', async () => {
    const id = await start();
    await saveAnswers(student, id, { q6: 'a' });
    await submitAttempt(student, id);
    expect(await submitAttempt(student, id)).toEqual({ status: 'grading' });
    expect(rec.current.grade).toHaveLength(1);
  });
  it('double submit concurrently: one scoring pass, one set of jobs, both resolve', async () => {
    const id = await start();
    await saveAnswers(student, id, { q6: 'a' });
    const [a, b] = await Promise.all([submitAttempt(student, id), submitAttempt(student, id)]);
    expect([a.status, b.status]).toEqual(['grading', 'grading']);
    expect(rec.current.grade).toHaveLength(1);
  });
  it('failed enqueue routes pending questions to score 0 + needsReview and still finalizes', async () => {
    const id = await start();
    await saveAnswers(student, id, { q6: 'a', q7: 'b' });
    rec.current.failNext = new Error('boom');
    expect(await submitAttempt(student, id)).toEqual({ status: 'graded' });
    const row = await rowOf(id);
    expect(row.status).toBe('graded');
    expect((row.results as Record<string, unknown>).q6).toMatchObject({ score: 0, needsReview: true });
    expect([row.score, row.maxScore]).toEqual(['0', '7']); // 5 mcq + the unanswered short (2); the two needs-review shorts are out of max
    expect(rec.current.grade).toHaveLength(0);
  });
});

describe('getAttempt', () => {
  it('keys hidden before submit, present after', async () => {
    const id = await start();
    const before = await getAttempt(student, id);
    expect(JSON.stringify(before)).not.toMatch(/correctIndex|modelAnswer|rubric/);
    expect(before.questions).toBeUndefined();
    expect(before.artifact.id).toBe(practiceId);
    await submitAttempt(student, id);
    const after = await getAttempt(student, id);
    expect(after.questions![0]).toMatchObject({ id: 'q0', correctIndex: 1 });
    expect(after.questions!.find((q) => q.id === 'q6')).toMatchObject({ modelAnswer: 'Because.', rubric: ['point one', 'point two'] });
    expect(JSON.stringify(after.artifact)).not.toMatch(/correctIndex|modelAnswer|rubric/);
  });
  it('mock exam view has a deadline without grace', async () => {
    setNow(() => T0);
    const id = await start(mockId);
    expect((await getAttempt(student, id)).deadline).toEqual(new Date(T0.getTime() + 120 * 60_000));
  });
  it("another student's attempt → NOT_FOUND on every function", async () => {
    const id = await start();
    const other = seed.b.student;
    await expect(getAttempt(other, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(saveAnswers(other, id, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(submitAttempt(other, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getAttempt(student, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('still works if the artifact row is the only source (snapshot titles)', async () => {
    const id = await start();
    expect((await getArtifact(student, practiceId)).id).toBe(practiceId);
    expect((await getAttempt(student, id)).artifactId).toBe(practiceId);
  });
});
