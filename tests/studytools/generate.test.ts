import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withPlatform } from '@/db/client';
import { artifacts, studentProfiles, usageDaily } from '@/db/schema';
import { handleGenerateJob } from '@/modules/studytools/generate';
import { getPattern } from '@/modules/studytools/patterns';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import {
  activateStudent, insertArtifact, mockFor, mockModel, practice, resetStudyMocks, seedStudyContent, useMockModels,
  useRecordingQueue,
} from '../helpers/study';

let seed: Seed;
let ids: { subjectId: string; chapterIds: string[]; chunkIds: string[] };
const getRow = async (id: string) => (await withPlatform((tx) => tx.select().from(artifacts).where(eq(artifacts.id, id))))[0];
const usageTokens = async (studentId: string) =>
  (await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.studentId, studentId)))).reduce((a, r) => a + r.tokens, 0);

/** A practice test whose questions cite P1..P3 and the given chapters round-robin. */
const validPractice = (n = 5, over: Record<string, unknown> = {}) => {
  const t = practice(n);
  t.questions.forEach((q, i) => {
    q.chapterId = ids.chapterIds[i % ids.chapterIds.length]!;
    q.passageRefs = [`P${(i % 3) + 1}`];
  });
  Object.assign(t, over);
  return t;
};

async function newArtifact(over: Partial<typeof artifacts.$inferInsert> = {}) {
  return insertArtifact(seed.a.schoolId, seed.a.student.userId!, ids.subjectId, {
    status: 'generating',
    content: null,
    chapterIds: ids.chapterIds,
    params: { questionCount: 5, chapterTitles: {} },
    ...over,
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills(STUDY_SKILLS);
  ids = await seedStudyContent(seed.a);
});
useRecordingQueue();
afterEach(() => {
  vi.restoreAllMocks();
  resetStudyMocks();
});

const job = async (over: Partial<typeof artifacts.$inferInsert> = {}, meta: { retryCount?: number; retryLimit?: number } = {}) => {
  const a = await newArtifact(over);
  return { a, data: { data: { artifactId: a.id, schoolId: seed.a.schoolId }, ...meta } };
};

describe('handleGenerateJob', () => {
  it('success stores content, sources, and source_chunk_ids; marks ready', async () => {
    useMockModels({ standard: mockModel([validPractice()]) });
    const { a, data } = await job();
    await handleGenerateJob(data);
    const row = await getRow(a.id);
    expect(row).toMatchObject({ status: 'ready', error: null });
    expect(row.sourceChunkIds.length).toBeGreaterThan(0);
    const content = row.content as any;
    expect(content.questions[0].chunkIds.length).toBeGreaterThan(0);
    expect(Object.keys(content.sources).length).toBeGreaterThan(0);
    for (const id of row.sourceChunkIds) expect(ids.chunkIds).toContain(id);
  });

  it('first output invalid, second valid → ready after exactly 2 model calls', async () => {
    const m = mockModel([{ title: 't', questions: [] }, validPractice()]);
    useMockModels({ standard: m });
    const { a, data } = await job();
    await handleGenerateJob(data);
    expect(m.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(m.doGenerateCalls[1]!.prompt)).toMatch(/invalid|error|did not match/i);
    expect((await getRow(a.id)).status).toBe('ready');
  });

  it('invalid twice → failed GENERATION_FAILED, no content, exactly 2 calls', async () => {
    const bad = { title: 't', questions: [] };
    const m = mockModel([bad, bad]);
    useMockModels({ standard: m });
    const { a, data } = await job();
    await handleGenerateJob(data);
    expect(await getRow(a.id)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED', content: null });
    expect(m.doGenerateCalls).toHaveLength(2);
  });

  it('an unknown passage ref (P99) counts as invalid and is repaired once', async () => {
    const m = mockModel([validPractice(5, { questions: validPractice().questions.map((q, i) => (i === 0 ? { ...q, passageRefs: ['P99'] } : q)) }), validPractice()]);
    useMockModels({ standard: m });
    const { a, data } = await job();
    await handleGenerateJob(data);
    expect(m.doGenerateCalls).toHaveLength(2);
    expect((await getRow(a.id)).status).toBe('ready');
  });

  it('a student over the chat token budget can still generate', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1');
    useMockModels({ standard: mockModel([validPractice()]) });
    const first = await job();
    await handleGenerateJob(first.data);
    const second = await job();
    await handleGenerateJob(second.data);
    expect((await getRow(second.a.id)).status).toBe('ready');
  });

  it('mock exam job uses the advanced model and the pattern from params', async () => {
    const pattern = (await getPattern('junior_50'))!;
    const mock = mockFor(pattern);
    mock.sections.forEach((s, si) =>
      s.questions.forEach((q, i) => {
        q.chapterId = ids.chapterIds[0]!;
        q.passageRefs = [`P${((si + i) % 3) + 1}`];
      }),
    );
    const std = mockModel([validPractice()]);
    const adv = mockModel([mock]);
    useMockModels({ standard: std, advanced: adv });
    const { a, data } = await job({ type: 'mock_exam', params: { patternKey: 'junior_50', chapterTitles: {} } });
    await handleGenerateJob(data);
    expect(adv.doGenerateCalls).toHaveLength(1);
    expect(std.doGenerateCalls).toHaveLength(0);
    expect(await getRow(a.id)).toMatchObject({ status: 'ready' });
  });

  it('records generation tokens in usage_daily', async () => {
    useMockModels({ standard: mockModel([validPractice()]) });
    const before = await usageTokens(seed.a.student.userId!);
    const { data } = await job();
    await handleGenerateJob(data);
    expect(await usageTokens(seed.a.student.userId!)).toBeGreaterThan(before);
  });

  it('provider error on a non-final attempt rethrows and leaves generating', async () => {
    useMockModels({ standard: mockModel([new Error('boom')]) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { a, data } = await job({}, { retryCount: 0, retryLimit: 2 });
    await expect(handleGenerateJob(data)).rejects.toThrow();
    expect((await getRow(a.id)).status).toBe('generating');
  });

  it('provider error on the final attempt marks failed', async () => {
    useMockModels({ standard: mockModel([new Error('boom')]) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { a, data } = await job({}, { retryCount: 2, retryLimit: 2 });
    await handleGenerateJob(data);
    expect(await getRow(a.id)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED' });
  });

  it('no visible chunks → failed, no model call', async () => {
    const m = mockModel([validPractice()]);
    useMockModels({ standard: m });
    const { a, data } = await job({ chapterIds: ['00000000-0000-4000-8000-0000000000ff'] });
    await handleGenerateJob(data);
    expect(await getRow(a.id)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED' });
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it('lapsed student at job time → failed, no model call', async () => {
    const m = mockModel([validPractice()]);
    useMockModels({ standard: m });
    const { a, data } = await job();
    const set = (status: string) =>
      withPlatform((tx) => tx.update(studentProfiles).set({ status }).where(eq(studentProfiles.userId, seed.a.student.userId!)));
    await set('lapsed');
    try {
      await handleGenerateJob(data);
    } finally {
      await set('active');
    }
    expect(await getRow(a.id)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED' });
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it('already-ready artifact, wrong school, and missing artifact are no-ops', async () => {
    const m = mockModel([validPractice()]);
    useMockModels({ standard: m });
    const ready = await newArtifact({ status: 'ready', content: { questions: [] } });
    await handleGenerateJob({ data: { artifactId: ready.id, schoolId: seed.a.schoolId } });
    const gen = await newArtifact();
    await handleGenerateJob({ data: { artifactId: gen.id, schoolId: seed.b.schoolId } });
    await handleGenerateJob({ data: { artifactId: '00000000-0000-4000-8000-0000000000aa', schoolId: seed.a.schoolId } });
    expect(m.doGenerateCalls).toHaveLength(0);
    expect(await getRow(ready.id)).toMatchObject({ status: 'ready', content: { questions: [] } });
    expect((await getRow(gen.id)).status).toBe('generating');
  });
});
