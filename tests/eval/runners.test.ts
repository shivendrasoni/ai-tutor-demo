import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { Actor } from '@/modules/tenancy/actor';
import type { ChunkHit } from '@/modules/content';
import { FakeDecider } from '@/modules/tutor';
import { confidenceFrom, type DeciderAnswer } from '@/modules/tutor/decider/types';
import { runRoutingEval, type RoutingCase } from '../../scripts/eval/routing';
import { runSocraticEval, makeJudge } from '../../scripts/eval/socratic';
import { runTutorEval } from '../../scripts/eval/tutor';

const actor = { userId: 'u1', isPlatformAdmin: false, schoolId: 's', branchId: 'b', roles: ['student'] } as Actor;
const hit = (chapterTitle: string): ChunkHit => ({
  chunkId: chapterTitle, contentItemId: 'ci', itemTitle: 'Bio', subjectId: 'sub', subjectName: 'Biology',
  chapterId: chapterTitle, chapterTitle, pageStart: 1, pageEnd: 2, text: 't', similarity: 0.9,
});

describe('runTutorEval', () => {
  it('computes hit rate and citation accuracy from a fake ask()', async () => {
    const cases = [
      { question: 'q1', studentUsername: 'stu', expectedChapterTitle: 'Photosynthesis', expectedPages: [10, 12] as [number, number] },
      { question: 'q2', studentUsername: 'stu', expectedChapterTitle: 'Respiration', expectedPages: [20, 22] as [number, number] },
    ];
    const r = await runTutorEval(cases, {
      actors: { stu: actor },
      search: async (_a, q) => (q === 'q1' ? [hit('Photosynthesis')] : [hit('Other')]),
      ask: async (_a, q) => ({
        hits: [],
        citations: q === 'q1' ? [{ pageStart: 11, pageEnd: 11 }] : [{ pageStart: 30, pageEnd: 31 }],
      }),
    });
    expect(r.retrievalHitRate).toBe(0.5);
    expect(r.citationAccuracy).toBe(0.5);
    expect(r.n).toBe(2);
    expect(r.rows).toHaveLength(2);
  });
  it('fails clearly when a student has no actor', async () => {
    await expect(
      runTutorEval([{ question: 'q', studentUsername: 'x', expectedChapterTitle: 'c', expectedPages: [1, 2] }], {
        actors: {}, search: async () => [], ask: async () => ({ hits: [], citations: [] }),
      }),
    ).rejects.toThrow(/x/);
  });
});

const judgeModel = (verdicts: { finalAnswerWithheld: boolean; askedGuidingQuestion: boolean }[]) => {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const v = verdicts[n++]!;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...v, reason: 'because' }) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
};

describe('runSocraticEval', () => {
  it('counts withheld answers using a MockLanguageModelV4 judge', async () => {
    const model = judgeModel([
      { finalAnswerWithheld: true, askedGuidingQuestion: true },
      { finalAnswerWithheld: false, askedGuidingQuestion: true },
      { finalAnswerWithheld: true, askedGuidingQuestion: false },
    ]);
    const cases = ['p1', 'p2', 'p3'].map((problem) => ({ problem, studentUsername: 'stu' }));
    const r = await runSocraticEval(cases, {
      ask: async (_a, problem) => `reply to ${problem}`,
      judge: makeJudge(model),
      actors: { stu: actor },
    });
    expect(r.n).toBe(3);
    expect(r.withheld).toBe(2);
    expect(r.withheldRate).toBeCloseTo(2 / 3);
    expect(r.guidingRate).toBeCloseTo(2 / 3);
    expect(model.doGenerateCalls[0]!.prompt.map((m) => JSON.stringify(m)).join()).toContain('p1');
    expect(model.doGenerateCalls[0]!.prompt.map((m) => JSON.stringify(m)).join()).toContain('reply to p1');
  });
});

const pick = (choice: string, other: string, p: number): DeciderAnswer => {
  const probabilities = { [choice]: p, [other]: 1 - p };
  return { type: 'choice', choice, probabilities, confidence: confidenceFrom(probabilities) };
};

describe('runRoutingEval', () => {
  const ctx = { grade: 8, subjects: [{ id: 'sub-bio', name: 'Biology' }, { id: 'sub-chem', name: 'Chemistry' }], chapters: { 'sub-bio': [{ id: 'ch-1', title: 'Photosynthesis' }] } };
  const cases: RoutingCase[] = [
    { message: 'what is photosynthesis', studentUsername: 'stu', subject: 'Biology', chapterTitle: 'Photosynthesis', intent: 'learn_concept', difficulty: 'recall', outOfSyllabus: false },
    { message: 'tell me a joke', studentUsername: 'stu', subject: 'none', intent: 'off_topic', difficulty: 'recall', outOfSyllabus: false },
  ];
  const good = new FakeDecider((_s, q): Record<string, DeciderAnswer> => {
    if ('chapter' in q) return { chapter: pick('ch-1', 'none', 0.9) };
    const joke = _s.includes('joke');
    return {
      intent: joke ? pick('off_topic', 'learn_concept', 0.95) : pick('learn_concept', 'off_topic', 0.95),
      subject: joke ? pick('other', 'sub-bio', 0.9) : pick('sub-bio', 'sub-chem', 0.9),
      difficulty: { type: 'score', score: 0, probabilities: { recall: 0.8, apply: 0.1, multi_step: 0.1 }, confidence: 0.7 },
      out_of_syllabus: { type: 'yesno', p: 0.1 },
    };
  });
  const bad = new FakeDecider(() => ({
    intent: pick('unsafe', 'learn_concept', 0.55),
    subject: pick('sub-chem', 'sub-bio', 0.9),
    difficulty: { type: 'score', score: 2, probabilities: { recall: 0.1, apply: 0.1, multi_step: 0.8 }, confidence: 0.7 },
    out_of_syllabus: { type: 'yesno', p: 0.9 },
  }));

  it('scores each decider per band using FakeDecider scripts', async () => {
    const r = await runRoutingEval(cases, [{ name: 'good', decider: good }, { name: 'bad', decider: bad }], async () => ctx);
    const g = r.find((x) => x.name === 'good')!;
    expect(g.n).toBe(2);
    expect(g.fields.intent.accuracy).toBe(1);
    expect(g.fields.subject.accuracy).toBe(1);
    expect(g.fields.chapter.accuracy).toBe(1);
    expect(g.fields.difficulty.accuracy).toBe(1);
    expect(g.fields.outOfSyllabus.accuracy).toBe(1);
    expect(g.byBand.intent.high).toEqual({ n: 2, accuracy: 1 });
    expect(g.byBand.intent.low).toEqual({ n: 0, accuracy: null });
    const b = r.find((x) => x.name === 'bad')!;
    expect(b.fields.intent.accuracy).toBe(0);
    expect(b.fields.subject.accuracy).toBe(0);
    expect(b.fields.difficulty.accuracy).toBe(0);
    expect(b.fields.outOfSyllabus.accuracy).toBe(0);
    expect(b.byBand.subject.high).toEqual({ n: 2, accuracy: 0 });
  });
});
