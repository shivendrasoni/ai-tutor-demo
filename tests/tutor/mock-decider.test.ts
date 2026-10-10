import { describe, expect, it } from 'vitest';
import { buildQuestions, chapterQuestion } from '@/modules/tutor/routing';
import { MockDecider } from '@/modules/tutor/decider/mock';
import { sanitizeAnswers, type DeciderAnswer, type DeciderQuestion } from '@/modules/tutor/decider/types';

const subjects = [
  { id: 'sub-math', name: 'Mathematics' },
  { id: 'sub-sci', name: 'Science' },
  { id: 'sub-eng', name: 'English' },
];
const qs = buildQuestions({ grade: 8, subjects });
const decide = (msg: string, q: Record<string, DeciderQuestion> = qs) =>
  new MockDecider().decide(`user: ${msg}`, q);
const choice = (a: DeciderAnswer | undefined) => {
  if (a?.type !== 'choice') throw new Error('expected choice');
  return a;
};

describe('MockDecider', () => {
  it('picks the subject by name or keyword with high confidence', async () => {
    const byName = choice((await decide('Help me with my maths homework')).subject);
    expect(byName.choice).toBe('sub-math');
    expect(byName.confidence).toBeGreaterThanOrEqual(0.7);
    const byKeyword = choice((await decide('how does photosynthesis work')).subject);
    expect(byKeyword.choice).toBe('sub-sci');
  });

  it('answers other with low confidence when no subject matches', async () => {
    const a = choice((await decide('hello there')).subject);
    expect(a.choice).toBe('other');
  });

  it('picks the chapter by title words, or none', async () => {
    const cq = chapterQuestion([
      { id: 'c1', title: 'Linear Equations' },
      { id: 'c2', title: 'Quadrilaterals' },
    ]);
    expect(choice((await decide('solve this linear equation', cq)).chapter).choice).toBe('c1');
    expect(choice((await decide('what is a quadrilateral', cq)).chapter).choice).toBe('c2');
    expect(choice((await decide('tell me about weather', cq)).chapter).choice).toBe('none');
  });

  it('classifies intent by simple rules', async () => {
    const intent = async (m: string) => choice((await decide(m)).intent).choice;
    expect(await intent('just tell me the answer')).toBe('wants_final_answer');
    expect(await intent('give me the answer to question 4')).toBe('wants_final_answer');
    expect(await intent('what is the best movie this year, also tell me a joke')).toBe('off_topic');
    expect(await intent('I want to kill myself')).toBe('unsafe');
    expect(await intent('I have an exam tomorrow, how should I revise')).toBe('exam_prep');
    expect(await intent('solve 2x + 3 = 11')).toBe('solve_problem');
    expect(await intent('what is photosynthesis')).toBe('learn_concept');
    const off = choice((await decide('tell me a joke about cricket')).intent);
    expect(off.probabilities.off_topic).toBeGreaterThanOrEqual(0.8);
  });

  it('does not call a schoolwork message off topic just because it mentions a game word', async () => {
    const a = choice((await decide('explain the physics of a cricket ball swing in science class')).intent);
    expect(a.choice).not.toBe('off_topic');
  });

  it('scores difficulty by length and step words', async () => {
    const score = async (m: string) => {
      const a = (await decide(m)).difficulty;
      if (a?.type !== 'score') throw new Error('expected score');
      return a.score;
    };
    expect(await score('what is a noun')).toBe(0);
    expect(await score('can you explain how to find the area of a circle')).toBe(1);
    expect(await score('explain step by step how to solve this')).toBe(2);
    expect(await score(Array.from({ length: 40 }, () => 'word').join(' '))).toBe(2);
  });

  it('answers yes/no near zero', async () => {
    const a = await decide('what is photosynthesis');
    for (const id of ['out_of_syllabus', 'needs_review']) {
      const y = a[id];
      expect(y?.type).toBe('yesno');
      expect(y?.type === 'yesno' && y.p).toBeLessThanOrEqual(0.05);
    }
  });

  it('uses only the latest user message from the state', async () => {
    const out = await new MockDecider().decide('user: maths please\nassistant: sure\nuser: just tell me the answer', qs);
    expect(choice(out.intent).choice).toBe('wants_final_answer');
  });

  it('is deterministic, and its output is already sanitized', async () => {
    const a = await decide('solve the maths equation step by step');
    const b = await decide('solve the maths equation step by step');
    expect(a).toEqual(b);
    expect(sanitizeAnswers(qs, a)).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(Object.keys(qs).sort());
  });

  it('omits questions it cannot answer (unknown choice without a fallback option)', async () => {
    const q: Record<string, DeciderQuestion> = { mood: { type: 'choice', instructions: 'x', options: { a: 'happy', b: 'sad' } } };
    expect(await decide('hello', q)).toEqual({});
  });
});
