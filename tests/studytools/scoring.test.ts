import { describe, expect, it } from 'vitest';
import { clampScore } from '@/modules/studytools/scoring';

describe('clampScore', () => {
  it.each([[7.3, 5, 5], [-1, 5, 0], [2.2, 5, 2], [2.25, 5, 2.5], [2.74, 5, 2.5], [0.2, 1, 0], [Number.NaN, 5, 0], [3, 5, 3]])(
    'clampScore(%s, %s) = %s', (s, m, e) => expect(clampScore(s, m)).toBe(e),
  );
});

import { buildByChapter, flattenQuestions, scoreMcq } from '@/modules/studytools/scoring';
import type { StoredQuestion } from '@/modules/studytools/schemas';

const mq = (o: Record<string, unknown> = {}) => ({ id: 'q1', type: 'mcq', prompt: 'p', options: ['a', 'b', 'c', 'd'], correctIndex: 2, marks: 1, chapterId: 'ch1', passageRefs: [], chunkIds: [], ...o }) as unknown as StoredQuestion;
const sq = (o: Record<string, unknown> = {}) => ({ id: 'q2', type: 'short', prompt: 'p', marks: 2, chapterId: 'ch1', passageRefs: [], chunkIds: [], ...o }) as unknown as StoredQuestion;

describe('scoreMcq', () => {
  it('correct, wrong, missing, wrong type', () => {
    expect(scoreMcq(mq(), 2)).toEqual({ score: 1, maxScore: 1, correct: true });
    expect(scoreMcq(mq(), 1)).toEqual({ score: 0, maxScore: 1, correct: false });
    expect(scoreMcq(mq(), undefined)).toEqual({ score: 0, maxScore: 1, correct: false });
    expect(scoreMcq(mq(), '2')).toEqual({ score: 0, maxScore: 1, correct: false });
    expect(scoreMcq(mq(), 2.5)).toEqual({ score: 0, maxScore: 1, correct: false });
  });
});

describe('flattenQuestions', () => {
  it('practice: questions; mock: sections in order', () => {
    expect(flattenQuestions({ questions: [mq(), sq()] }).map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(flattenQuestions({ sections: [{ questions: [mq({ id: 'a' })] }, { questions: [sq({ id: 'b' }), sq({ id: 'c' })] }] }).map((q) => q.id)).toEqual(['a', 'b', 'c']);
    expect(flattenQuestions({ sections: [{ heading: 'x' }] })).toEqual([]);
  });
});

describe('buildByChapter', () => {
  it('sums per chapter and counts unanswered marks in max', () => {
    const qs = [mq({ id: 'q1' }), sq({ id: 'q2' }), sq({ id: 'q3', chapterId: 'ch2' })];
    const results = { q1: { score: 1, maxScore: 1 }, q2: { score: 1.5, maxScore: 2 }, q3: { score: 0, maxScore: 2 } };
    expect(buildByChapter(qs, results)).toEqual({ ch1: { scored: 2.5, max: 3 }, ch2: { scored: 0, max: 2 } });
    expect(buildByChapter(qs, {})).toEqual({ ch1: { scored: 0, max: 3 }, ch2: { scored: 0, max: 2 } });
  });

  it('leaves needs-review questions out of scored and max, and omits a chapter that has nothing left', () => {
    const qs = [mq({ id: 'q1' }), sq({ id: 'q2' }), sq({ id: 'q3', chapterId: 'ch2' })];
    const results = {
      q1: { score: 1, maxScore: 1 },
      q2: { score: 0, maxScore: 2, needsReview: true as const },
      q3: { score: 0, maxScore: 2, needsReview: true as const },
    };
    expect(buildByChapter(qs, results)).toEqual({ ch1: { scored: 1, max: 1 } });
  });
});
