/**
 * Cross-school isolation for study tools. Every case acts as School A's actors and targets School B ids;
 * each must reject or return no B data, and B's rows must not change. School B has real artifacts and attempts
 * (in progress, grading, graded) so a leak would surface.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { artifacts, attempts } from '@/db/schema';
import {
  chapterProgress, getArtifact, getAttempt, handleGenerateJob, handleGradeJob, listArtifacts,
  requestArtifact, saveAnswers, startAttempt, submitAttempt,
} from '@/modules/studytools';
import { setNow } from '@/modules/studytools/clock';
import { recoverStuckAttempt } from '@/modules/studytools/grading';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, insertArtifact, mockModel, resetStudyMocks, seedStudyContent, useMockModels, useRecordingQueue } from '../helpers/study';

type Side = {
  artifactId: string;
  generatingId: string;
  inProgressId: string;
  gradingId: string;
  gradedId: string;
  chapterIds: string[];
  subjectId: string;
};
let seed: Seed;
let a: Actor;
let b: Actor;
let A: Side;
let B: Side;
const rec = useRecordingQueue();
const graderModel = mockModel([{ score: 2, feedback: 'ok' }]);

const codeOf = (p: Promise<unknown>) =>
  p.then(() => 'RESOLVED', (e) => (e as { code?: string }).code ?? 'ERROR');
const snapshot = (schoolId: string) =>
  withPlatform(async (tx) => ({
    artifacts: await tx.select().from(artifacts).where(eq(artifacts.schoolId, schoolId)).orderBy(artifacts.id),
    attempts: await tx.select().from(attempts).where(eq(attempts.schoolId, schoolId)).orderBy(attempts.id),
  }));

async function seedSide(s: Seed['a'], label: string): Promise<Side> {
  const { subjectId, chapterIds, chunkIds } = await seedStudyContent(s, { chapters: 3 });
  const content = {
    title: `Secret ${label} test`,
    questions: [
      { id: 'q1', type: 'mcq', prompt: `SECRET-${label}-MCQ`, options: ['a', 'b', 'c', 'd'], correctIndex: 2, marks: 1, chapterId: chapterIds[0], passageRefs: ['P1'], chunkIds: [chunkIds[0]] },
      { id: 'q2', type: 'short', prompt: `SECRET-${label}-SHORT`, modelAnswer: `SECRET-${label}-MODEL`, rubric: ['x', 'y'], marks: 2, chapterId: chapterIds[1], passageRefs: ['P1'], chunkIds: [chunkIds[1]] },
    ],
    sources: { [chunkIds[0]!]: { itemTitle: `Book ${label}`, chapterTitle: 'Chapter 1', pageStart: 1, pageEnd: 2 }, [chunkIds[1]!]: { itemTitle: `Book ${label}`, chapterTitle: 'Chapter 2', pageStart: 3, pageEnd: 4 } },
  };
  const chapterTitles = { [chapterIds[0]!]: `Title-${label}-1`, [chapterIds[1]!]: `Title-${label}-2` };
  const base = { content, chapterIds: [chapterIds[0]!, chapterIds[1]!], params: { chapterTitles, questionCount: 2 } };
  const student = s.student.userId;
  const art = await insertArtifact(s.schoolId, student, subjectId, base);
  const generating = await insertArtifact(s.schoolId, student, subjectId, { ...base, status: 'generating', content: null });
  const mkAttempt = (artifactId: string, over: Partial<typeof attempts.$inferInsert>) =>
    withPlatform(async (tx) => (await tx.insert(attempts).values({ schoolId: s.schoolId, artifactId, studentId: student, status: 'in_progress', answers: {}, ...over }).returning())[0]!);
  const inProg = await mkAttempt(art.id, { answers: { q1: 2, q2: `my-${label}-answer` } });
  const grading = await mkAttempt(art.id, {
    status: 'grading', submittedAt: new Date(), answers: { q1: 2, q2: `pending-${label}-answer` }, results: { q1: { score: 1, maxScore: 1, correct: true } },
  });
  const graded = await mkAttempt(art.id, {
    status: 'graded', submittedAt: new Date(), gradedAt: new Date(), answers: { q1: 2, q2: `final-${label}-answer` },
    results: { q1: { score: 1, maxScore: 1, correct: true }, q2: { score: 1.5, maxScore: 2, feedback: `FEEDBACK-${label}` } },
    score: '2.5', maxScore: '3',
    byChapter: { [chapterIds[0]!]: { scored: 1, max: 1 }, [chapterIds[1]!]: { scored: 1.5, max: 2 } },
  });
  return { artifactId: art.id, generatingId: generating.id, inProgressId: inProg.id, gradingId: grading.id, gradedId: graded.id, chapterIds, subjectId };
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  a = seed.a.student;
  b = seed.b.student;
  await Promise.all([activateStudent(a), activateStudent(b)]);
  await seedSkills(STUDY_SKILLS);
  A = await seedSide(seed.a, 'A');
  B = await seedSide(seed.b, 'B');
});
afterEach(() => {
  setNow(null);
  resetStudyMocks();
});
afterAll(async () => {
  await closeDb();
});

const bIds = () => [B.artifactId, B.generatingId, B.inProgressId, B.gradingId, B.gradedId, ...B.chapterIds, B.subjectId, seed.b.studentId, seed.b.schoolId];

describe('study tools isolation: School A actors vs School B ids', () => {
  it('B really has data (non-vacuous)', async () => {
    const snap = await snapshot(seed.b.schoolId);
    expect(snap.artifacts).toHaveLength(2);
    expect(snap.attempts).toHaveLength(3);
    expect((await getArtifact(b, B.artifactId)).attempts).toHaveLength(3);
    expect((await chapterProgress(seed.b.schoolAdmin)).length).toBeGreaterThan(0);
  });

  it('artifact and attempt operations on B ids are NOT_FOUND and leave B unchanged', async () => {
    const before = await snapshot(seed.b.schoolId);
    expect(await codeOf(getArtifact(a, B.artifactId))).toBe('NOT_FOUND');
    expect(await codeOf(getArtifact(a, B.generatingId))).toBe('NOT_FOUND');
    expect(await codeOf(startAttempt(a, B.artifactId))).toBe('NOT_FOUND');
    for (const id of [B.inProgressId, B.gradingId, B.gradedId]) {
      expect(await codeOf(getAttempt(a, id))).toBe('NOT_FOUND');
      expect(await codeOf(saveAnswers(a, id, { q1: 0 }))).toBe('NOT_FOUND');
      expect(await codeOf(submitAttempt(a, id))).toBe('NOT_FOUND');
    }
    expect(rec.current.grade).toEqual([]);
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
  });

  it("A's own attempt ids still work (the NOT_FOUNDs are not blanket failures)", async () => {
    expect((await getAttempt(a, A.gradedId)).score).toBe(2.5);
    expect((await getArtifact(a, A.artifactId)).attempts).toHaveLength(3);
  });

  it('B students cannot touch A ids either (other direction)', async () => {
    const before = await snapshot(seed.a.schoolId);
    expect(await codeOf(getArtifact(b, A.artifactId))).toBe('NOT_FOUND');
    expect(await codeOf(startAttempt(b, A.artifactId))).toBe('NOT_FOUND');
    expect(await codeOf(getAttempt(b, A.gradedId))).toBe('NOT_FOUND');
    expect(await codeOf(saveAnswers(b, A.inProgressId, { q1: 0 }))).toBe('NOT_FOUND');
    expect(await codeOf(submitAttempt(b, A.inProgressId))).toBe('NOT_FOUND');
    expect(await snapshot(seed.a.schoolId)).toEqual(before);
  });

  it("requestArtifact with B's subject and chapters is VALIDATION and creates nothing", async () => {
    const before = [await snapshot(seed.a.schoolId), await snapshot(seed.b.schoolId)];
    expect(await codeOf(requestArtifact(a, { type: 'practice_test', subjectId: seed.b.subjectId, chapterIds: B.chapterIds }))).toBe('VALIDATION');
    // B's chapters under A's own subject
    expect(await codeOf(requestArtifact(a, { type: 'practice_test', subjectId: A.subjectId, chapterIds: B.chapterIds }))).toBe('VALIDATION');
    // one A chapter mixed with a B chapter
    expect(await codeOf(requestArtifact(a, { type: 'study_notes', subjectId: A.subjectId, chapterIds: [A.chapterIds[0]!, B.chapterIds[0]!] }))).toBe('VALIDATION');
    expect(rec.current.generate).toEqual([]);
    expect([await snapshot(seed.a.schoolId), await snapshot(seed.b.schoolId)]).toEqual(before);
    // reverse
    expect(await codeOf(requestArtifact(b, { type: 'practice_test', subjectId: seed.a.subjectId, chapterIds: A.chapterIds }))).toBe('VALIDATION');
    expect(await snapshot(seed.a.schoolId)).toEqual(before[0]);
  });

  it('listArtifacts returns only own ids, in both directions', async () => {
    const la = await listArtifacts(a, {});
    expect(la.map((x) => x.id).sort()).toEqual([A.artifactId, A.generatingId].sort());
    const lb = await listArtifacts(b, {});
    expect(lb.map((x) => x.id).sort()).toEqual([B.artifactId, B.generatingId].sort());
    expect(JSON.stringify(la)).not.toContain('Secret B');
  });

  it('chapterProgress for A staff never returns B rows', async () => {
    const bStudent = seed.b.studentId;
    for (const staff of [seed.a.schoolAdmin, seed.a.branchAdmin, seed.a.teacher]) {
      const rows = await chapterProgress(staff);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.studentId === seed.a.studentId)).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/Title-B|-B-/);
      expect(rows.some((r) => B.chapterIds.includes(r.chapterId) || r.subjectId === B.subjectId)).toBe(false);
      expect(await chapterProgress(staff, { studentIds: [bStudent] })).toEqual([]);
      expect(await chapterProgress(staff, { studentIds: [bStudent, seed.a.studentId] }).then((r) => r.every((x) => x.studentId === seed.a.studentId))).toBe(true);
      expect(await chapterProgress(staff, { subjectId: B.subjectId })).toEqual([]);
    }
    // reverse
    const rb = await chapterProgress(seed.b.schoolAdmin);
    expect(rb.length).toBeGreaterThan(0);
    expect(rb.every((r) => r.studentId === bStudent)).toBe(true);
    expect(await chapterProgress(seed.b.schoolAdmin, { studentIds: [seed.a.studentId] })).toEqual([]);
  });

  it('handleGradeJob with a mismatched school is a no-op on B', async () => {
    useMockModels({ standard: graderModel });
    const before = await snapshot(seed.b.schoolId);
    await handleGradeJob({ data: { attemptId: B.gradingId, schoolId: seed.a.schoolId, questionId: 'q2' } });
    expect(graderModel.doGenerateCalls).toHaveLength(0);
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
    // reverse direction
    const beforeA = await snapshot(seed.a.schoolId);
    await handleGradeJob({ data: { attemptId: A.gradingId, schoolId: seed.b.schoolId, questionId: 'q2' } });
    expect(await snapshot(seed.a.schoolId)).toEqual(beforeA);
    expect(graderModel.doGenerateCalls).toHaveLength(0);
  });

  it('handleGenerateJob with B artifact under A schoolId is a no-op', async () => {
    useMockModels({ standard: graderModel, advanced: graderModel });
    const before = await snapshot(seed.b.schoolId);
    await handleGenerateJob({ data: { artifactId: B.generatingId, schoolId: seed.a.schoolId } });
    expect(graderModel.doGenerateCalls).toHaveLength(0);
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
    expect(before.artifacts.find((x) => x.id === B.generatingId)?.status).toBe('generating');
  });

  it('recoverStuckAttempt under A schoolId leaves a stuck B attempt untouched', async () => {
    const later = new Date(Date.now() + 3_600_000);
    setNow(() => later);
    const before = await snapshot(seed.b.schoolId);
    await recoverStuckAttempt(seed.a.schoolId, B.gradingId);
    expect(rec.current.grade).toEqual([]);
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
    // non-vacuous: the same call with the right school does enqueue
    await recoverStuckAttempt(seed.b.schoolId, B.gradingId);
    expect(rec.current.grade).toEqual([{ attemptId: B.gradingId, schoolId: seed.b.schoolId, questionId: 'q2' }]);
  });

  it('raw tenant queries see only own rows and cannot write B rows', async () => {
    const rawA = await withTenant(seed.a.schoolId, async (tx) => ({
      artifacts: await tx.select().from(artifacts),
      attempts: await tx.select().from(attempts),
    }));
    expect(rawA.artifacts.length).toBe(2);
    expect(rawA.attempts.length).toBe(3);
    expect(rawA.artifacts.every((r) => r.schoolId === seed.a.schoolId)).toBe(true);
    expect(rawA.attempts.every((r) => r.schoolId === seed.a.schoolId)).toBe(true);

    const before = await snapshot(seed.b.schoolId);
    const upd = await withTenant(seed.a.schoolId, (tx) =>
      tx.update(attempts).set({ answers: { q1: 0 } }).where(inArray(attempts.id, [B.inProgressId, B.gradingId, B.gradedId])).returning(),
    );
    expect(upd).toHaveLength(0);
    const updArt = await withTenant(seed.a.schoolId, (tx) => tx.update(artifacts).set({ status: 'failed' }).where(eq(artifacts.id, B.artifactId)).returning());
    expect(updArt).toHaveLength(0);
    const del = await withTenant(seed.a.schoolId, (tx) => tx.delete(attempts).where(eq(attempts.id, B.gradedId)).returning());
    expect(del).toHaveLength(0);
    // inserting a B-school row from an A tenant is rejected by RLS
    await expect(
      withTenant(seed.a.schoolId, (tx) =>
        tx.insert(attempts).values({ schoolId: seed.b.schoolId, artifactId: B.artifactId, studentId: seed.b.studentId, status: 'in_progress' }),
      ),
    ).rejects.toThrow();
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
  });

  it('deep scan: no B id or text appears in anything returned to A', async () => {
    const outputs: unknown[] = [
      await getArtifact(a, A.artifactId),
      await listArtifacts(a, {}),
      await getAttempt(a, A.inProgressId),
      await getAttempt(a, A.gradingId),
      await getAttempt(a, A.gradedId),
      await chapterProgress(seed.a.schoolAdmin),
    ];
    const json = JSON.stringify(outputs);
    for (const id of bIds()) expect(json).not.toContain(id);
    expect(json).not.toMatch(/SECRET-B|FEEDBACK-B|Title-B|Book B|-B-answer/);
    // non-vacuous: the same scan on A's data does contain A markers
    expect(json).toContain('SECRET-A');
    expect(json).toContain(A.artifactId);
  });
});
