import { type DeciderAnswer, type DeciderQuestion, sanitizeAnswers } from './decider/types';

/** The only place that holds routing numbers (parent §6.3), so the routing eval can tune it. */
export const THRESHOLDS = {
  filterHigh: 0.7,
  filterMid: 0.4,
  advancedP: 0.5,
  offTopic: 0.8,
  unsafe: 0.5,
  outOfSyllabus: 0.6,
  needsReview: 0.5,
};

export const INTENTS = [
  'learn_concept',
  'solve_problem',
  'wants_final_answer',
  'exam_prep',
  'off_topic',
  'unsafe',
] as const;

const LEVELS = ['recall', 'apply', 'multi_step'];

const INTENT_LABELS: Record<(typeof INTENTS)[number], string> = {
  learn_concept: 'the student wants to understand a concept',
  solve_problem: 'the student wants help solving a problem',
  wants_final_answer: 'the student just wants the final answer handed over',
  exam_prep: 'the student is preparing for an exam',
  off_topic: 'not about schoolwork or learning',
  unsafe: 'harmful, dangerous, sexual, hateful, or about self-harm',
};

export function buildQuestions(a: {
  grade: number;
  subjects: { id: string; name: string }[];
}): Record<string, DeciderQuestion> {
  return {
    intent: {
      type: 'choice',
      instructions: 'What is the student trying to do with their latest message?',
      options: { ...INTENT_LABELS },
    },
    subject: {
      type: 'choice',
      instructions: 'Which subject does the latest message belong to?',
      options: { ...Object.fromEntries(a.subjects.map((s) => [s.id, s.name])), other: 'none of these subjects' },
    },
    difficulty: {
      type: 'score',
      instructions: `How demanding is the question for a class ${a.grade} student? recall = remembering a fact, apply = using one idea, multi_step = several linked steps.`,
      levels: [...LEVELS],
    },
    out_of_syllabus: {
      type: 'yesno',
      statement: `The question goes beyond the class ${a.grade} syllabus.`,
    },
    needs_review: {
      type: 'yesno',
      statement: 'A teacher or parent should look at this message (distress, bullying, or a worrying situation).',
    },
  };
}

export function chapterQuestion(chapters: { id: string; title: string }[]): Record<string, DeciderQuestion> {
  return {
    chapter: {
      type: 'choice',
      instructions: 'Which chapter does the latest message belong to?',
      options: { ...Object.fromEntries(chapters.map((c) => [c.id, c.title])), none: 'none of these chapters' },
    },
  };
}

type ChoiceAnswer = Extract<DeciderAnswer, { type: 'choice' }>;

const choiceOf = (a: DeciderAnswer | undefined): ChoiceAnswer | undefined => (a?.type === 'choice' ? a : undefined);

/** Ids to filter on for a choice answer: [choice] when high, top-2 valid when mid, undefined otherwise. */
function band(a: DeciderAnswer | undefined, valid: string[]): string[] | undefined {
  const c = choiceOf(a);
  if (!c || !valid.includes(c.choice)) return undefined;
  if (c.confidence >= THRESHOLDS.filterHigh) return [c.choice];
  if (c.confidence >= THRESHOLDS.filterMid) {
    const top = Object.entries(c.probabilities)
      .filter(([id, p]) => valid.includes(id) && p > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .map(([id]) => id);
    return top.length ? top : [c.choice];
  }
  return undefined;
}

export function needsChapterCall(answers: Record<string, DeciderAnswer>, validSubjectIds: string[]): boolean {
  const c = choiceOf(answers.subject);
  return !!c && validSubjectIds.includes(c.choice) && c.confidence >= THRESHOLDS.filterMid;
}

export function topSubjectsForChapters(answers: Record<string, DeciderAnswer>, validSubjectIds: string[]): string[] {
  return band(answers.subject, validSubjectIds) ?? [];
}

export type RouteCtx = { skillKey: string; subjectIds: string[]; chapterIds: string[] };

export type RouteResult = {
  intent: string;
  subjectIds?: string[];
  chapterIds?: string[];
  tier: 'standard' | 'advanced';
  outOfSyllabus: boolean;
  needsReview: boolean;
  effectiveSkillKey: string;
  fixedReply?: 'off_topic' | 'unsafe';
  switchedToSocratic: boolean;
  decisions: { answers: Record<string, DeciderAnswer>; tier: string };
};

export function routeTurn(raw: Record<string, DeciderAnswer>, ctx: RouteCtx): RouteResult {
  const questions: Record<string, DeciderQuestion> = {
    intent: { type: 'choice', instructions: '', options: Object.fromEntries(INTENTS.map((i) => [i, i])) },
    subject: {
      type: 'choice',
      instructions: '',
      options: Object.fromEntries([...ctx.subjectIds, 'other'].map((i) => [i, i])),
    },
    chapter: {
      type: 'choice',
      instructions: '',
      options: Object.fromEntries([...ctx.chapterIds, 'none'].map((i) => [i, i])),
    },
    difficulty: { type: 'score', instructions: '', levels: LEVELS },
    out_of_syllabus: { type: 'yesno', statement: '' },
    needs_review: { type: 'yesno', statement: '' },
  };
  const answers = sanitizeAnswers(questions, raw);

  const intentA = choiceOf(answers.intent);
  const intent = intentA?.choice ?? 'unknown';
  const unsafe = (intentA?.probabilities.unsafe ?? 0) >= THRESHOLDS.unsafe && !!intentA?.probabilities.unsafe;
  const offTopic = intent === 'off_topic' && intentA!.confidence >= THRESHOLDS.offTopic;
  const fixedReply = unsafe ? 'unsafe' : offTopic ? 'off_topic' : undefined;

  const diff = answers.difficulty?.type === 'score' ? answers.difficulty : undefined;
  const tier = (diff?.probabilities.multi_step ?? 0) >= THRESHOLDS.advancedP && !!diff?.probabilities.multi_step
    ? 'advanced'
    : 'standard';

  const yes = (k: string, t: number) => {
    const a = answers[k];
    return a?.type === 'yesno' && a.p >= t;
  };

  const switchedToSocratic = intent === 'wants_final_answer' && ctx.skillKey === 'explain';

  return {
    intent,
    subjectIds: band(answers.subject, ctx.subjectIds),
    chapterIds: band(answers.chapter, ctx.chapterIds),
    tier,
    outOfSyllabus: yes('out_of_syllabus', THRESHOLDS.outOfSyllabus),
    needsReview: yes('needs_review', THRESHOLDS.needsReview),
    effectiveSkillKey: switchedToSocratic ? 'socratic' : ctx.skillKey,
    fixedReply,
    switchedToSocratic,
    decisions: { answers, tier },
  };
}
