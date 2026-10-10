import type { StoredQuestion } from './schemas';

/** Clamps a score to 0..marks and rounds to the nearest 0.5. Non-finite input scores 0. */
export function clampScore(score: number, marks: number): number {
  if (!Number.isFinite(score)) return 0;
  const rounded = Math.round(score * 2) / 2;
  return Math.min(Math.max(rounded, 0), marks);
}

export type QuestionResult = { score: number; maxScore: number; feedback?: string; correct?: boolean; needsReview?: true };
export type Results = Record<string, QuestionResult>;
export type ByChapter = Record<string, { scored: number; max: number }>;

/** Practice tests: `questions`; mock exams: every section's questions in order. Anything else yields no questions. */
export function flattenQuestions(content: unknown): StoredQuestion[] {
  const c = (content ?? {}) as { questions?: unknown; sections?: unknown };
  if (Array.isArray(c.questions)) return c.questions as StoredQuestion[];
  if (Array.isArray(c.sections)) {
    return (c.sections as { questions?: unknown }[]).flatMap((s) => (Array.isArray(s?.questions) ? (s.questions as StoredQuestion[]) : []));
  }
  return [];
}

export function scoreMcq(q: StoredQuestion, answer: unknown): { score: number; maxScore: number; correct: boolean } {
  const correct = Number.isInteger(answer) && answer === q.correctIndex;
  return { score: correct ? q.marks : 0, maxScore: q.marks, correct };
}

/** `max` counts every question's marks, answered or not. */
export function buildByChapter(questions: StoredQuestion[], results: Results): ByChapter {
  const out: ByChapter = {};
  for (const q of questions) {
    const e = (out[q.chapterId] ??= { scored: 0, max: 0 });
    e.max += q.marks;
    e.scored += results[q.id]?.score ?? 0;
  }
  return out;
}
