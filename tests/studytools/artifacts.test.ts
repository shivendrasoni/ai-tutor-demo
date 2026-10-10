import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { artifacts, attempts, contentItems, subjects } from '@/db/schema';
import { getArtifact, listArtifacts, requestArtifact } from '@/modules/studytools/artifacts';
import { setNow } from '@/modules/studytools/clock';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { seedChunks, seedItem } from '../helpers/content';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, insertArtifact, seedStudyContent, useRecordingQueue } from '../helpers/study';

const SECRET_MODEL_ANSWER_TEXT = 'SECRET-MODEL-ANSWER-TEXT';
const SECRET_RUBRIC_TEXT = 'SECRET-RUBRIC-TEXT';

let seed: Seed;
let subjectId: string;
let chapterIds: string[];
let chunkIds: string[];
let otherSubjectChapter: string;
const rec = useRecordingQueue();

const rowOf = async (id: string) => (await withPlatform((tx) => tx.select().from(artifacts).where(eq(artifacts.id, id))))[0]!;
const cleanArtifacts = () => withPlatform((tx) => tx.delete(artifacts));
afterEach(async () => {
  setNow(null);
  await cleanArtifacts();
});

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await activateStudent(seed.b.student);
  await seedSkills(STUDY_SKILLS);
  ({ subjectId, chapterIds, chunkIds } = await seedStudyContent(seed.a, { chapters: 8 }));
  // A second subject with its own chapter.
  const [sub2] = await withPlatform((tx) => tx.insert(subjects).values({ schoolId: seed.a.schoolId, name: 'Science' }).returning());
  const item = await seedItem(seed.a, { subjectId: sub2!.id });
  await seedChunks(item.id, [{ title: 'Sci 1', texts: ['science passage'] }]);
  const r = await withPlatform((tx) => tx.execute(sql`select id from content_chapters where content_item_id = ${item.id}`));
  otherSubjectChapter = (r.rows[0] as { id: string }).id;
});

const base = () => ({ type: 'practice_test' as const, subjectId, chapterIds: [chapterIds[0]!, chapterIds[1]!] });

async function insertReadyArtifact(type: string) {
  const q = (id: string, kind: 'mcq' | 'short') => ({
    id, type: kind, prompt: `Prompt ${id}`, marks: kind === 'mcq' ? 1 : 2, chapterId: chapterIds[0], passageRefs: ['P1'], chunkIds: [chunkIds[0]],
    ...(kind === 'mcq' ? { options: ['a', 'b', 'c', 'd'], correctIndex: 2 } : { modelAnswer: SECRET_MODEL_ANSWER_TEXT, rubric: [SECRET_RUBRIC_TEXT, 'x'] }),
  });
  const sources = { [chunkIds[0]!]: { itemTitle: 'Test Book', chapterTitle: 'Chapter 1', pageStart: 1, pageEnd: 2 } };
  const content =
    type === 'practice_test'
      ? { title: 'T', questions: [q('q1', 'mcq'), q('q2', 'short')], sources, extra: 'leak' }
      : type === 'mock_exam'
        ? { title: 'T', patternKey: 'junior_50', durationMinutes: 120, sections: [{ key: 'A', title: 'A', questions: [q('a1', 'mcq'), q('a2', 'short')] }], sources }
        : { title: 'T', sections: [{ heading: 'H', bodyMarkdown: 'body', chapterId: chapterIds[0], passageRefs: ['P1'], chunkIds: [chunkIds[0]] }], sources };
  return (
    await insertArtifact(seed.a.schoolId, seed.a.student.userId!, subjectId, {
      type, content, chapterIds: [chapterIds[0]!], params: { chapterTitles: { [chapterIds[0]!]: 'Chapter 1' } }, sourceChunkIds: [chunkIds[0]!],
    })
  ).id;
}

describe('requestArtifact', () => {
  it('creates a generating artifact and enqueues exactly one job', async () => {
    const { id } = await requestArtifact(seed.a.student, base());
    expect(rec.current.generate).toEqual([{ artifactId: id, schoolId: seed.a.schoolId }]);
    expect(await rowOf(id)).toMatchObject({
      status: 'generating', type: 'practice_test',
      params: expect.objectContaining({ questionCount: 10, chapterTitles: { [chapterIds[0]!]: 'Chapter 1', [chapterIds[1]!]: 'Chapter 2' } }),
    });
  });

  it('deduplicates chapters', async () => {
    const { id } = await requestArtifact(seed.a.student, { ...base(), chapterIds: [chapterIds[0]!, chapterIds[0]!] });
    expect((await rowOf(id)).chapterIds).toEqual([chapterIds[0]]);
  });

  it.each([
    ['no chapters', () => ({ chapterIds: [] })],
    ['7 chapters', () => ({ chapterIds: chapterIds.slice(0, 7) })],
    ['questionCount 4', () => ({ questionCount: 4 })],
    ['questionCount 31', () => ({ questionCount: 31 })],
    ['questionCount 7.5', () => ({ questionCount: 7.5 })],
    ['chapter from another subject', () => ({ chapterIds: [otherSubjectChapter] })],
    ['unknown chapter id', () => ({ chapterIds: [randomUUID()] })],
    ['patternKey on practice test', () => ({ patternKey: 'junior_50' })],
    ['questionCount on notes', () => ({ type: 'study_notes' as const, questionCount: 10 })],
  ])('VALIDATION: %s', async (_n, over) => {
    await expect(requestArtifact(seed.a.student, { ...base(), ...over() })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(rec.current.generate).toHaveLength(0);
  });

  it('mock exam: grade 8 student defaults to junior_50, rejects standard_80 and unknown', async () => {
    const mockInput = { ...base(), type: 'mock_exam' as const };
    const { id } = await requestArtifact(seed.a.student, mockInput);
    expect((await rowOf(id)).params).toMatchObject({ patternKey: 'junior_50' });
    await expect(requestArtifact(seed.a.student, { ...mockInput, patternKey: 'standard_80' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(requestArtifact(seed.a.student, { ...mockInput, patternKey: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(requestArtifact(seed.a.student, { ...mockInput, patternKey: 'junior_50' })).resolves.toBeDefined();
  });

  it('uses the skill of the artifact type', async () => {
    const { id } = await requestArtifact(seed.a.student, { ...base(), type: 'last_night_notes' });
    const r = await withPlatform((tx) => tx.execute(sql`select s.key from artifacts a join skills s on s.id = a.skill_id where a.id = ${id}`));
    expect((r.rows[0] as { key: string }).key).toBe('last_night_notes_generator');
  });

  it('hidden chapter is VALIDATION for a NEW request', async () => {
    const item = await seedItem(seed.a);
    await seedChunks(item.id, [{ title: 'Hidden', texts: ['x'] }]);
    const r = await withPlatform((tx) => tx.execute(sql`select id from content_chapters where content_item_id = ${item.id}`));
    const hidden = (r.rows[0] as { id: string }).id;
    await expect(requestArtifact(seed.a.student, { ...base(), chapterIds: [hidden] })).resolves.toBeDefined();
    await withPlatform((tx) => tx.update(contentItems).set({ ingestStatus: 'failed' }).where(eq(contentItems.id, item.id)));
    await expect(requestArtifact(seed.a.student, { ...base(), chapterIds: [hidden] })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('pending student and teacher are FORBIDDEN', async () => {
    await expect(requestArtifact(seed.a.teacher, base())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await withPlatform((tx) => tx.execute(sql`update student_profiles set status = 'pending_payment' where user_id = ${seed.a.student.userId}`));
    try {
      await expect(requestArtifact(seed.a.student, base())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await activateStudent(seed.a.student);
    }
  });

  it('11th generation in a UTC day is GENERATION_LIMIT; the day boundary resets', async () => {
    setNow(() => new Date('2027-03-01T23:59:59Z'));
    for (let i = 0; i < 10; i++) await requestArtifact(seed.a.student, base());
    await expect(requestArtifact(seed.a.student, base())).rejects.toMatchObject({ code: 'GENERATION_LIMIT' });
    setNow(() => new Date('2027-03-02T00:00:00Z'));
    await expect(requestArtifact(seed.a.student, base())).resolves.toBeDefined();
  });

  it('limit counts failed artifacts and is per student', async () => {
    for (let i = 0; i < 10; i++) await insertArtifact(seed.a.schoolId, seed.a.student.userId!, subjectId, { status: 'failed', error: 'GENERATION_FAILED' });
    await expect(requestArtifact(seed.a.student, base())).rejects.toMatchObject({ code: 'GENERATION_LIMIT' });
  });

  it('concurrent requests at 9/10: exactly one succeeds', async () => {
    for (let i = 0; i < 9; i++) await requestArtifact(seed.a.student, base());
    const r = await Promise.allSettled([requestArtifact(seed.a.student, base()), requestArtifact(seed.a.student, base())]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected')[0]).toMatchObject({ reason: { code: 'GENERATION_LIMIT' } });
  });

  it('enqueue failure marks the artifact failed instead of leaving it generating', async () => {
    rec.current.failNext = new Error('boom');
    await expect(requestArtifact(seed.a.student, base())).rejects.toThrow('boom');
    expect((await listArtifacts(seed.a.student, {}))[0]).toMatchObject({ status: 'failed' });
    const all = await withPlatform((tx) => tx.select().from(artifacts));
    expect(all[0]).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED' });
  });
});

describe('getArtifact', () => {
  it('never leaks answer keys: deep scan for every type', async () => {
    for (const kind of ['practice_test', 'mock_exam', 'study_notes', 'last_night_notes']) {
      const view = await getArtifact(seed.a.student, await insertReadyArtifact(kind));
      const json = JSON.stringify(view);
      expect(json).not.toMatch(/correctIndex|modelAnswer|rubric|leak|chunkIds|passageRefs/);
      expect(json).not.toContain(SECRET_MODEL_ANSWER_TEXT);
      expect(json).not.toContain(SECRET_RUBRIC_TEXT);
      expect(view.status).toBe('ready');
    }
  });

  it('exposes questions, options and citations', async () => {
    const v = await getArtifact(seed.a.student, await insertReadyArtifact('practice_test'));
    expect(v.questions![0]).toMatchObject({ id: 'q1', type: 'mcq', options: ['a', 'b', 'c', 'd'], marks: 1 });
    expect(v.questions![0]!.citations).toEqual([{ chunkId: chunkIds[0], itemTitle: 'Test Book', chapterTitle: 'Chapter 1', pageStart: 1, pageEnd: 2 }]);
    const m = await getArtifact(seed.a.student, await insertReadyArtifact('mock_exam'));
    expect(m).toMatchObject({ durationMinutes: 120, sections: [{ key: 'A' }] });
    const n = await getArtifact(seed.a.student, await insertReadyArtifact('study_notes'));
    expect(n.notes![0]).toMatchObject({ heading: 'H', bodyMarkdown: 'body' });
  });

  it('generating and failed artifacts have no content', async () => {
    const { id } = await requestArtifact(seed.a.student, base());
    const v = await getArtifact(seed.a.student, id);
    expect(v).toMatchObject({ status: 'generating', error: null });
    expect(v.questions).toBeUndefined();
  });

  it('another student, another school, or an unknown id is NOT_FOUND', async () => {
    const id = await insertReadyArtifact('practice_test');
    await expect(getArtifact(seed.b.student, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getArtifact(seed.a.student, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getArtifact(seed.a.student, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('survives chapters/chunks being deleted after generation', async () => {
    const id = await insertReadyArtifact('practice_test');
    await withPlatform((tx) => tx.delete(contentItems));
    const v = await getArtifact(seed.a.student, id);
    expect(v.status).toBe('ready');
    expect(v.questions![0]!.citations.length).toBeGreaterThan(0);
    expect(Object.values(v.chapterTitles).length).toBeGreaterThan(0);
  });
});

describe('listArtifacts', () => {
  it('filters by type, lists only own, newest first, with attempt stats', async () => {
    const a1 = await insertReadyArtifact('practice_test');
    const a2 = await insertReadyArtifact('study_notes');
    await withPlatform((tx) =>
      tx.insert(attempts).values([
        { schoolId: seed.a.schoolId, artifactId: a1, studentId: seed.a.student.userId!, status: 'graded', score: '3', maxScore: '4' },
        { schoolId: seed.a.schoolId, artifactId: a1, studentId: seed.a.student.userId!, status: 'graded', score: '1', maxScore: '4' },
        { schoolId: seed.a.schoolId, artifactId: a1, studentId: seed.a.student.userId!, status: 'in_progress' },
      ]),
    );
    await insertArtifact(seed.b.schoolId, seed.b.student.userId!, seed.b.subjectId);
    const all = await listArtifacts(seed.a.student, {});
    expect(all.map((x) => x.id)).toEqual([a2, a1]);
    expect(all[1]).toMatchObject({ attemptCount: 3, bestScorePct: 75 });
    expect(all[0]).toMatchObject({ attemptCount: 0, bestScorePct: null });
    expect((await listArtifacts(seed.a.student, { type: 'practice_test' })).map((x) => x.id)).toEqual([a1]);
    expect(await listArtifacts(seed.b.student, { type: 'study_notes' })).toEqual([]);
  });
});
