import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withPlatform } from '@/db/client';
import { usageDaily } from '@/db/schema';
import type { ChunkHit } from '@/modules/content';
import { callGenerator, callGrader, SKILL_FOR_TYPE, tierFor } from '@/modules/studytools/llm';
import { getPattern, type ExamPatternRow } from '@/modules/studytools/patterns';
import type { ValidationCtx } from '@/modules/studytools/validate';
import { seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import * as structured from '@/modules/tutor/structured';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { CH, mockFor, notes, practice, mockModel, resetStudyMocks, useMockModels, activateStudent } from '../helpers/study';

let seed: Seed;
let actor: Seed['a']['student'];
let junior50: ExamPatternRow;
const hits: ChunkHit[] = Array.from({ length: 12 }, (_, i) => ({
  chunkId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, contentItemId: 'ci', itemTitle: 'Bio', subjectId: 's',
  subjectName: 'Biology', chapterId: CH, chapterTitle: 'Cells', pageStart: i + 1, pageEnd: i + 2, text: `passage ${i + 1}`, similarity: 1,
}));
const mockCtx = (pattern: ExamPatternRow): ValidationCtx => ({ type: 'mock_exam', chapterIds: [CH], passageCount: 12, pattern });

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  actor = seed.a.student;
  await activateStudent(actor);
  await seedSkills(STUDY_SKILLS);
  junior50 = (await getPattern('junior_50'))!;
});
afterEach(() => {
  vi.restoreAllMocks();
  resetStudyMocks();
});

describe('callGenerator', () => {
  it('maps types to skills and tiers', () => {
    expect(SKILL_FOR_TYPE).toEqual({
      practice_test: 'practice_test_generator', mock_exam: 'mock_exam_generator',
      study_notes: 'study_notes_generator', last_night_notes: 'last_night_notes_generator',
    });
    expect(tierFor('mock_exam')).toBe('advanced');
    for (const t of ['practice_test', 'study_notes', 'last_night_notes'] as const) expect(tierFor(t)).toBe('standard');
  });
  it('mock exams use the advanced model, others standard', async () => {
    const std = mockModel([practice(10)]);
    const adv = mockModel([mockFor(junior50)]);
    useMockModels({ standard: std, advanced: adv });
    await callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) });
    expect(adv.doGenerateCalls).toHaveLength(1);
    expect(std.doGenerateCalls).toHaveLength(0);
    await callGenerator(actor, { type: 'practice_test', prompt: 'x', hits, ctx: { type: 'practice_test', chapterIds: [CH], passageCount: 12, questionCount: 10 } });
    expect(std.doGenerateCalls).toHaveLength(1);
  });
  it('passes labelled passages as context', async () => {
    const adv = mockModel([mockFor(junior50)]);
    useMockModels({ advanced: adv });
    await callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) });
    expect(JSON.stringify(adv.doGenerateCalls[0]!.prompt)).toContain('[P12] Cells');
  });
  it('a semantically invalid first output triggers the single repair with the error in the prompt', async () => {
    const m = mockModel([mockFor(junior50, { drop: 'B' }), mockFor(junior50)]);
    useMockModels({ advanced: m });
    const r = await callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) });
    expect(m.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(m.doGenerateCalls[1]!.prompt)).toMatch(/section B/i);
    expect(r.value).toMatchObject({ patternKey: 'junior_50' });
    expect(r.usage.tokensIn).toBe(20);
  });
  it('two semantically invalid outputs reject with VALIDATION', async () => {
    const m = mockModel([mockFor(junior50, { drop: 'B' })]);
    useMockModels({ advanced: m });
    await expect(callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(m.doGenerateCalls).toHaveLength(2);
  });
  it('generation ignores the chat token budget (skipBudget: true)', async () => {
    const spy = vi.spyOn(structured, 'runSkillStructured');
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1');
    useMockModels({ standard: mockModel([notes()]) });
    const ctx: ValidationCtx = { type: 'study_notes', chapterIds: [CH], passageCount: 12 };
    await callGenerator(actor, { type: 'study_notes', prompt: 'x', hits, ctx });
    // usage (15 tokens) now exceeds the limit of 1; a second generation still succeeds
    await callGenerator(actor, { type: 'study_notes', prompt: 'x', hits, ctx });
    expect(spy.mock.calls.every((c) => c[2].skipBudget === true)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('callGrader', () => {
  it('clamps to marks, rounds to 0.5, trims feedback to 60 words', async () => {
    useMockModels({ standard: mockModel([{ score: 7.3, feedback: 'w '.repeat(90) }]) });
    const r = await callGrader(actor, 'p', 5);
    expect(r.score).toBe(5);
    expect(r.feedback.split(/\s+/)).toHaveLength(60);
  });
  it('rounds to the nearest half mark and keeps short feedback intact', async () => {
    useMockModels({ standard: mockModel([{ score: 2.3, feedback: 'Good effort.' }]) });
    expect(await callGrader(actor, 'p', 5)).toEqual({ score: 2.5, feedback: 'Good effort.' });
  });
  it('grades even when the daily chat budget is exhausted, and records usage', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1');
    useMockModels({ standard: mockModel([{ score: 1, feedback: 'ok' }]) });
    await callGrader(actor, 'p', 2);
    await expect(callGrader(actor, 'p', 2)).resolves.toMatchObject({ score: 1 });
    const rows = await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.studentId, actor.userId)));
    expect(rows.reduce((a, r) => a + r.tokens, 0)).toBeGreaterThan(1);
  });
  it('rejects a score outside the schema (non-number) with VALIDATION', async () => {
    useMockModels({ standard: mockModel([{ score: 'high', feedback: 'x' }]) });
    await expect(callGrader(actor, 'p', 2)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
