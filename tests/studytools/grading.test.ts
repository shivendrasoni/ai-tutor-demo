import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPlatform, withTenant } from '@/db/client';
import { attempts } from '@/db/schema';
import { setNow } from '@/modules/studytools/clock';
import { registerStudyToolsWorkers } from '@/modules/studytools/queue';
import { getAttempt, saveAnswers, startAttempt, submitAttempt } from '@/modules/studytools/attempts';
import { failPendingQuestions, finalizeAttempt } from '@/modules/studytools/finalize';
import { handleGradeJob, STUCK_AFTER_MS } from '@/modules/studytools/grading';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, insertArtifact, mcq, mockModel, resetStudyMocks, short, useMockModels, useRecordingQueue } from '../helpers/study';

const CH1 = '00000000-0000-4000-8000-0000000000c1';
const CH2 = '00000000-0000-4000-8000-0000000000c2';
let seed: Seed;
let student: Actor;
let artifactId: string;
let attemptId: string;
const rec = useRecordingQueue();

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  student = seed.a.student;
  await activateStudent(student);
  await seedSkills(STUDY_SKILLS);
  artifactId = (
    await insertArtifact(seed.a.schoolId, student.userId!, seed.a.subjectId, {
      content: {
        questions: [
          { ...mcq({ id: 'm0', chapterId: CH1 }), chunkIds: [] },
          { ...short({ id: 's0', chapterId: CH1 }), chunkIds: [] },
          { ...short({ id: 'l0', type: 'long', marks: 5, chapterId: CH2 }), chunkIds: [] },
        ],
        sources: {},
      },
    })
  ).id;
});
afterEach(async () => {
  setNow(null);
  resetStudyMocks();
  vi.restoreAllMocks();
  await withPlatform((tx) => tx.delete(attempts));
});

/** A submitted attempt: m0 right, s0 and l0 answered (two grade jobs recorded). */
beforeEach(async () => {
  attemptId = (await startAttempt(student, artifactId)).attemptId;
  await saveAnswers(student, attemptId, { m0: 1, s0: 'short answer', l0: 'long answer' });
  await submitAttempt(student, attemptId);
});

const row = async () => (await withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.id, attemptId))))[0]!;
const results = async () => (await row()).results as Record<string, Record<string, unknown>>;
const job = (i: number) => ({ data: rec.current.grade[i]! });

describe('handleGradeJob', () => {
  it('grades a question and merges feedback; the attempt finalizes only when the last result arrives', async () => {
    useMockModels({ standard: mockModel([{ score: 1.5, feedback: 'Good, mention X.' }, { score: 4, feedback: 'Add Y.' }]) });
    expect(rec.current.grade).toHaveLength(2);
    await handleGradeJob(job(0));
    expect((await getAttempt(student, attemptId)).status).toBe('grading');
    await handleGradeJob(job(1));
    const v = await getAttempt(student, attemptId);
    expect(v).toMatchObject({ status: 'graded', score: 1 + 1.5 + 4, maxScore: 1 + 2 + 5 });
    expect(v.results!.s0).toMatchObject({ score: 1.5, maxScore: 2, feedback: 'Good, mention X.' });
    expect(v.byChapter).toEqual({ [CH1]: { scored: 2.5, max: 3 }, [CH2]: { scored: 4, max: 5 } });
  });

  it('clamps the score to marks and rounds to 0.5 in the stored result', async () => {
    useMockModels({ standard: mockModel([{ score: 99, feedback: 'f' }, { score: 2.3, feedback: 'f' }]) });
    await handleGradeJob(job(0));
    await handleGradeJob(job(1));
    const r = await results();
    expect(r.s0).toMatchObject({ score: 2 });
    expect(r.l0).toMatchObject({ score: 2.5 });
  });

  it('calls the model once per job', async () => {
    const model = mockModel([{ score: 1, feedback: 'f' }]);
    useMockModels({ standard: model });
    await handleGradeJob(job(0));
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('a grader failing on the FINAL retry scores 0 with needsReview and the attempt still reaches graded', async () => {
    useMockModels({ standard: mockModel([new Error('provider down')]) });
    await handleGradeJob({ ...job(0), retryCount: 2, retryLimit: 2 });
    await handleGradeJob({ ...job(1), retryCount: 2, retryLimit: 2 });
    expect(await getAttempt(student, attemptId)).toMatchObject({ status: 'graded', score: 1 });
    expect(await results()).toMatchObject({
      s0: { score: 0, maxScore: 2, needsReview: true },
      l0: { score: 0, maxScore: 5, needsReview: true },
    });
  });

  it('a grader failing on a NON-final retry rethrows and records nothing', async () => {
    useMockModels({ standard: mockModel([new Error('provider down')]) });
    await expect(handleGradeJob({ ...job(0), retryCount: 0, retryLimit: 2 })).rejects.toThrow();
    expect((await getAttempt(student, attemptId)).status).toBe('grading');
    expect((await results()).s0).toBeUndefined();
  });

  it('two grade jobs finishing concurrently finalize once with the right total', async () => {
    // Both jobs call the model concurrently, so which one consumes which scripted reply is scheduler-dependent. Use
    // the same reply for both (2 fits both s0 = 2 marks and l0 = 5 marks) so the total never depends on call order.
    useMockModels({ standard: mockModel([{ score: 2, feedback: 'f' }]) });
    await Promise.all(rec.current.grade.map((data) => handleGradeJob({ data })));
    const v = await getAttempt(student, attemptId);
    expect(v).toMatchObject({ status: 'graded', score: 1 + 2 + 2 });
    const gradedAt = (await row()).gradedAt;
    expect(gradedAt).not.toBeNull();
    // A second finalize has nothing to do and leaves graded_at untouched.
    expect(await withTenant(seed.a.schoolId, (tx) => finalizeAttempt(tx, attemptId))).toBe(false);
    expect((await row()).gradedAt).toEqual(gradedAt);
  });

  it('a redelivered job for an already-graded question is a no-op (no model call, result kept)', async () => {
    const model = mockModel([{ score: 1, feedback: 'first' }, { score: 2, feedback: 'second' }]);
    useMockModels({ standard: model });
    await handleGradeJob(job(0));
    await handleGradeJob(job(0));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await results()).s0).toMatchObject({ score: 1, feedback: 'first' });
  });

  it('a late grade never overwrites a needsReview zero set by failPendingQuestions', async () => {
    const model = mockModel([{ score: 2, feedback: 'late' }]);
    useMockModels({ standard: model });
    await failPendingQuestions(seed.a.schoolId, attemptId);
    expect((await row()).status).toBe('graded');
    await handleGradeJob(job(0));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await results()).s0).toMatchObject({ score: 0, needsReview: true });
    expect((await row()).score).toBe('1');
  });

  it('a job for an attempt that is not grading is a no-op', async () => {
    const model = mockModel([{ score: 1, feedback: 'f' }]);
    useMockModels({ standard: model });
    await handleGradeJob({ data: { ...rec.current.grade[0]!, attemptId: '00000000-0000-4000-8000-00000000dead' } });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('a blank stored answer never reaches the grader and scores 0', async () => {
    const model = mockModel([{ score: 2, feedback: 'f' }]);
    useMockModels({ standard: model });
    await withPlatform((tx) => tx.update(attempts).set({ answers: { m0: 1, s0: '   ', l0: 'x' } }).where(eq(attempts.id, attemptId)));
    await handleGradeJob(job(0));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await results()).s0).toMatchObject({ score: 0, maxScore: 2 });
  });
});

describe('failure paths', () => {
  it('failPendingQuestions retries once when the first transaction fails', async () => {
    const db = await import('@/db/client');
    const spy = vi.spyOn(db, 'withTenant').mockRejectedValueOnce(new Error('transient'));
    await failPendingQuestions(seed.a.schoolId, attemptId);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await row()).status).toBe('graded');
  });

  it('failPendingQuestions that fails twice rethrows (submit surfaces the error instead of hiding it)', async () => {
    const db = await import('@/db/client');
    vi.spyOn(db, 'withTenant').mockRejectedValue(new Error('db down'));
    await expect(failPendingQuestions(seed.a.schoolId, attemptId)).rejects.toThrow('db down');
  });

  it('enqueue failure at submit does not strand the attempt', async () => {
    const id = (await startAttempt(student, artifactId)).attemptId;
    await saveAnswers(student, id, { m0: 1, s0: 'a', l0: 'b' });
    rec.current.failNext = new Error('boom');
    expect(await submitAttempt(student, id)).toEqual({ status: 'graded' });
    const r = (await withPlatform((tx) => tx.select().from(attempts).where(eq(attempts.id, id))))[0]!.results as Record<string, unknown>;
    expect(r.s0).toMatchObject({ needsReview: true });
  });
});

describe('recovery of stuck attempts', () => {
  const later = async (ms: number) => {
    const at = (await row()).submittedAt!.getTime() + ms;
    setNow(() => new Date(at));
  };

  it('older than 10 minutes: getAttempt re-enqueues only questions without a result', async () => {
    useMockModels({ standard: mockModel([{ score: 1, feedback: 'f' }]) });
    await handleGradeJob(job(0)); // s0 graded
    rec.current.grade.length = 0;
    await later(STUCK_AFTER_MS + 1);
    expect((await getAttempt(student, attemptId)).status).toBe('grading');
    expect(rec.current.grade).toEqual([{ attemptId, schoolId: seed.a.schoolId, questionId: 'l0' }]);
  });

  it('is rate limited: five polls of a stuck attempt enqueue once, and again only after another STUCK_AFTER_MS', async () => {
    rec.current.grade.length = 0;
    await later(STUCK_AFTER_MS + 1);
    for (let i = 0; i < 5; i++) await getAttempt(student, attemptId);
    expect(rec.current.grade.map((j) => j.questionId).sort()).toEqual(['l0', 's0']);
    const at = (await row()).submittedAt!.getTime() + 2 * STUCK_AFTER_MS + 2;
    setNow(() => new Date(at));
    await getAttempt(student, attemptId);
    expect(rec.current.grade).toHaveLength(4);
  });

  it('younger than 10 minutes: no-op', async () => {
    rec.current.grade.length = 0;
    await later(STUCK_AFTER_MS - 1);
    await getAttempt(student, attemptId);
    await submitAttempt(student, attemptId);
    expect(rec.current.grade).toHaveLength(0);
  });

  it('resubmit of a stuck attempt also recovers', async () => {
    rec.current.grade.length = 0;
    await later(STUCK_AFTER_MS + 1);
    expect(await submitAttempt(student, attemptId)).toEqual({ status: 'grading' });
    expect(rec.current.grade.map((j) => j.questionId).sort()).toEqual(['l0', 's0']);
  });

  it('enqueue failing during recovery zeroes the pending questions and the attempt becomes graded', async () => {
    rec.current.grade.length = 0;
    await later(STUCK_AFTER_MS + 1);
    rec.current.failNext = new Error('queue down');
    const v = await getAttempt(student, attemptId);
    expect(v.status).toBe('graded');
    expect(await results()).toMatchObject({ s0: { needsReview: true }, l0: { needsReview: true } });
  });
});

describe('registered grade worker', () => {
  const handlerFor = async () => {
    const calls: any[][] = [];
    await registerStudyToolsWorkers({ createQueue: async () => {}, getQueue: async () => null, deleteQueue: async () => {}, work: async (...a: any[]) => void calls.push(a) } as any);
    return calls.find((c) => c[0] === 'studytools.grade')![2] as (jobs: unknown[]) => Promise<void>;
  };

  it('rethrows on a non-final attempt and writes a needsReview zero on the final one', async () => {
    useMockModels({ standard: mockModel([new Error('provider down')]) });
    const handler = await handlerFor();
    const data = rec.current.grade[0]!;
    await expect(handler([{ data, retryCount: 0, retryLimit: 2 }])).rejects.toThrow();
    expect((await results()).s0).toBeUndefined();
    await expect(handler([{ data, retryCount: 2, retryLimit: 2 }])).resolves.toBeUndefined();
    expect((await results()).s0).toMatchObject({ score: 0, needsReview: true });
  });
});
