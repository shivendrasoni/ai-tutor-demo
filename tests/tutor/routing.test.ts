import { describe, expect, it } from 'vitest';
import type { DeciderAnswer } from '../../src/modules/tutor/decider/types';
import {
  buildQuestions,
  chapterQuestion,
  needsChapterCall,
  routeTurn,
  topSubjectsForChapters,
} from '../../src/modules/tutor/routing';

const ch = (choice: string, probabilities: Record<string, number>, confidence: number): DeciderAnswer => ({
  type: 'choice',
  choice,
  probabilities,
  confidence,
});
const sc = (score: number, probabilities: Record<string, number>, confidence = 0.9): DeciderAnswer => ({
  type: 'score',
  score,
  probabilities,
  confidence,
});
const yn = (p: number): DeciderAnswer => ({ type: 'yesno', p });

const ctx = { skillKey: 'socratic', subjectIds: ['m', 's'], chapterIds: ['c1', 'c2', 'c3'] };

describe('routeTurn threshold table', () => {
  it.each([
    ['subject 0.70 → filter', { subject: ch('m', { m: 0.85, s: 0.15 }, 0.7) }, { subjectIds: ['m'] }],
    ['subject 0.699 → top-2', { subject: ch('m', { m: 0.6, s: 0.3, other: 0.1 }, 0.699) }, { subjectIds: ['m', 's'] }],
    ['subject 0.40 → top-2', { subject: ch('m', { m: 0.5, s: 0.4, other: 0.1 }, 0.4) }, { subjectIds: ['m', 's'] }],
    ['subject 0.399 → no filter', { subject: ch('m', { m: 0.4, s: 0.3, other: 0.3 }, 0.399) }, { subjectIds: undefined }],
    ['subject high but "other"', { subject: ch('other', { other: 1 }, 0.95) }, { subjectIds: undefined }],
    [
      'chapter 0.7 → filter',
      { subject: ch('m', { m: 1 }, 0.9), chapter: ch('c1', { c1: 0.9, none: 0.1 }, 0.7) },
      { chapterIds: ['c1'] },
    ],
    [
      'chapter mid → top-2',
      { chapter: ch('c1', { c1: 0.5, c2: 0.35, none: 0.15 }, 0.5) },
      { chapterIds: ['c1', 'c2'] },
    ],
    ['chapter none', { chapter: ch('none', { none: 1 }, 0.9) }, { chapterIds: undefined }],
    [
      'multi_step p=0.5 → advanced',
      { difficulty: sc(2, { recall: 0.2, apply: 0.3, multi_step: 0.5 }) },
      { tier: 'advanced' },
    ],
    [
      'multi_step p=0.49 → standard',
      { difficulty: sc(2, { recall: 0.2, apply: 0.31, multi_step: 0.49 }) },
      { tier: 'standard' },
    ],
    [
      'off_topic conf 0.8 → fixed',
      { intent: ch('off_topic', { off_topic: 0.9, learn_concept: 0.1 }, 0.8) },
      { fixedReply: 'off_topic' },
    ],
    [
      'off_topic conf 0.79 → none',
      { intent: ch('off_topic', { off_topic: 0.6, learn_concept: 0.4 }, 0.79) },
      { fixedReply: undefined },
    ],
    [
      'unsafe p 0.5 → fixed',
      { intent: ch('learn_concept', { learn_concept: 0.5, unsafe: 0.5 }, 0.2) },
      { fixedReply: 'unsafe' },
    ],
    [
      'unsafe beats off_topic',
      { intent: ch('off_topic', { off_topic: 0.85, unsafe: 0.5 }, 0.9) },
      { fixedReply: 'unsafe' },
    ],
    [
      'unsafe p 0.49 → none',
      { intent: ch('learn_concept', { learn_concept: 0.51, unsafe: 0.49 }, 0.5) },
      { fixedReply: undefined },
    ],
    ['out_of_syllabus 0.6', { out_of_syllabus: yn(0.6) }, { outOfSyllabus: true }],
    ['out_of_syllabus 0.59', { out_of_syllabus: yn(0.59) }, { outOfSyllabus: false }],
    ['needs_review 0.5', { needs_review: yn(0.5) }, { needsReview: true }],
    ['needs_review 0.49', { needs_review: yn(0.49) }, { needsReview: false }],
  ] as [string, Record<string, DeciderAnswer>, object][])('%s', (_n, answers, expected) =>
    expect(routeTurn(answers, ctx)).toMatchObject(expected),
  );

  it('wants_final_answer on explain → socratic; on socratic → unchanged', () => {
    const answers = { intent: ch('wants_final_answer', { wants_final_answer: 0.9, learn_concept: 0.1 }, 0.8) };
    expect(routeTurn(answers, { ...ctx, skillKey: 'explain' })).toMatchObject({
      intent: 'wants_final_answer',
      effectiveSkillKey: 'socratic',
      switchedToSocratic: true,
    });
    expect(routeTurn(answers, ctx)).toMatchObject({ effectiveSkillKey: 'socratic', switchedToSocratic: false });
    expect(
      routeTurn({ intent: ch('learn_concept', { learn_concept: 1 }, 1) }, { ...ctx, skillKey: 'explain' }),
    ).toMatchObject({ effectiveSkillKey: 'explain', switchedToSocratic: false });
  });

  it('Decider failure ({}) → no filters, standard, no override, intent unknown', () =>
    expect(routeTurn({}, ctx)).toMatchObject({
      intent: 'unknown',
      tier: 'standard',
      subjectIds: undefined,
      chapterIds: undefined,
      fixedReply: undefined,
      outOfSyllabus: false,
      needsReview: false,
      effectiveSkillKey: 'socratic',
    }));

  it('option ids not in ctx are ignored, never leaked into filters', () => {
    const r = routeTurn(
      {
        subject: ch('ghost', { ghost: 1 }, 0.99),
        chapter: ch('c9', { c9: 1 }, 0.99),
        intent: ch('made_up', { made_up: 1 }, 1),
        difficulty: sc(9, {}),
      },
      ctx,
    );
    expect(r).toMatchObject({ subjectIds: undefined, chapterIds: undefined, intent: 'unknown', tier: 'standard' });
  });

  it('mid-band top-2 with a ghost id drops it', () => {
    const r = routeTurn({ subject: ch('m', { m: 0.5, ghost: 0.4, s: 0.1 }, 0.5) }, ctx);
    // ghost is not an option, so the whole answer is invalid
    expect(r.subjectIds).toBeUndefined();
    const r2 = routeTurn({ subject: ch('m', { m: 0.5, s: 0.1, other: 0.4 }, 0.5) }, ctx);
    expect(r2.subjectIds).toEqual(['m', 's']);
  });

  it('mid band with only one positive valid id returns just that one', () => {
    const r = routeTurn({ subject: ch('m', { m: 0.6, s: 0, other: 0.4 }, 0.5) }, ctx);
    expect(r.subjectIds).toEqual(['m']);
  });

  it('decisions carry sanitized answers and tier', () => {
    const good = ch('m', { m: 0.85, s: 0.15 }, 0.7);
    const r = routeTurn({ subject: good, chapter: ch('c9', { c9: 1 }, 1) }, ctx);
    expect(r.decisions).toEqual({ answers: { subject: good }, tier: 'standard' });
  });
});

describe('chapter helpers', () => {
  const subj = (choice: string, conf: number, probs: Record<string, number>) => ({
    subject: ch(choice, probs, conf),
  });
  it('needsChapterCall / topSubjectsForChapters', () => {
    const ids = ['m', 's'];
    expect(needsChapterCall({}, ids)).toBe(false);
    expect(needsChapterCall(subj('m', 0.399, { m: 0.5, s: 0.5 }), ids)).toBe(false);
    expect(needsChapterCall(subj('other', 0.9, { other: 1 }), ids)).toBe(false);
    expect(needsChapterCall(subj('m', 0.4, { m: 0.5, s: 0.4, other: 0.1 }), ids)).toBe(true);
    expect(topSubjectsForChapters(subj('m', 0.7, { m: 0.85, s: 0.15 }), ids)).toEqual(['m']);
    expect(topSubjectsForChapters(subj('m', 0.5, { m: 0.5, s: 0.4, other: 0.1 }), ids)).toEqual(['m', 's']);
    expect(topSubjectsForChapters({}, ids)).toEqual([]);
  });
});

describe('question builders', () => {
  it('buildQuestions: subject options include every subject plus other; difficulty levels in order', () => {
    const q = buildQuestions({
      grade: 7,
      subjects: [
        { id: 'm', name: 'Maths' },
        { id: 's', name: 'Science' },
      ],
    });
    expect(Object.keys(q).sort()).toEqual(['difficulty', 'intent', 'needs_review', 'out_of_syllabus', 'subject']);
    const subject = q.subject as { type: 'choice'; options: Record<string, string> };
    expect(Object.keys(subject.options)).toEqual(['m', 's', 'other']);
    expect(subject.options.m).toBe('Maths');
    expect(q.difficulty).toMatchObject({ type: 'score', levels: ['recall', 'apply', 'multi_step'] });
    expect(q.out_of_syllabus.type).toBe('yesno');
    expect(q.needs_review.type).toBe('yesno');
    expect(Object.keys((q.intent as { options: object }).options)).toEqual([
      'learn_concept',
      'solve_problem',
      'wants_final_answer',
      'exam_prep',
      'off_topic',
      'unsafe',
    ]);
  });
  it('chapterQuestion: id → title plus none', () => {
    const q = chapterQuestion([{ id: 'c1', title: 'Fractions' }]);
    expect(q.chapter).toMatchObject({ type: 'choice', options: { c1: 'Fractions', none: expect.any(String) } });
  });
});
