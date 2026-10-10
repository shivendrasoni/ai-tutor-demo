import type { ChunkHit } from '@/modules/content';
import type { ExamPatternRow } from './patterns';
import type { ArtifactType } from './schemas';

/** `[P1] chapter, p.a–b\ntext` blocks separated by a blank line; the labels are what `passageRefs` cite. */
export const formatPassages = (hits: ChunkHit[]): string =>
  hits.map((h, i) => `[P${i + 1}] ${h.chapterTitle}, p.${h.pageStart}–${h.pageEnd}\n${h.text}`).join('\n\n');

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

type GeneratorInput = {
  type: ArtifactType;
  grade: number;
  chapters: { id: string; title: string }[];
  questionCount?: number;
  pattern?: ExamPatternRow;
};

function typeRules(i: GeneratorInput): string {
  switch (i.type) {
    case 'practice_test': {
      const n = i.questionCount ?? 10;
      return `Write a practice test with exactly ${n} questions. About 60% must be mcq (1 mark each, 4 options, correctIndex 0..3); the rest short (2 marks each, with modelAnswer and a 2-5 point rubric). Question ids must be unique.`;
    }
    case 'mock_exam': {
      const p = i.pattern;
      if (!p) throw new Error('mock_exam prompt needs a pattern');
      const sections = p.sections
        .map((s) => `Section ${s.key} (${s.title}): exactly ${s.count} ${s.questionType} questions, ${plural(s.marksEach, 'mark')} each`)
        .join('\n');
      return `Write a mock exam following pattern "${p.key}" exactly: patternKey "${p.key}", durationMinutes ${p.durationMinutes}. Use these sections in this order with these section keys:\n${sections}\nmcq questions have 4 options and a correctIndex; short, long and case questions have a modelAnswer and a 2-5 point rubric. Question ids must be unique across the exam.`;
    }
    default:
      return `Write ${i.type === 'study_notes' ? 'study notes' : 'last-night revision notes'}: key formulas, definitions and likely questions. At most 2 sections per chapter, each bodyMarkdown at most 120 words. Every section has a heading, bodyMarkdown, chapterId and passageRefs.`;
  }
}

/** The passages are not included here; they travel as the `context` argument of the structured call. */
export function buildGeneratorPrompt(i: GeneratorInput): string {
  const chapters = i.chapters.map((c) => `- chapterId ${c.id}: ${c.title}`).join('\n');
  return `${typeRules(i)}

The student is in grade ${i.grade}.
Use only these chapters, and set chapterId to one of these values exactly:
${chapters}

Use only the passages below. Cite passages in passageRefs as P<n>, matching the [P<n>] labels.`;
}

export function buildGraderPrompt(
  q: { prompt: string; type: string; marks: number; modelAnswer: string; rubric: string[] },
  studentAnswer: string,
): string {
  return `Grade the student's answer to this ${q.type} question.

Question (${plural(q.marks, 'mark')}): ${q.prompt}
Model answer: ${q.modelAnswer}
Rubric:
${q.rubric.map((r) => `- ${r}`).join('\n')}

Student answer:
"""
${studentAnswer.trim() || '(no answer given)'}
"""

Return score (0 to ${q.marks}, in steps of 0.5) and feedback (at most 60 words, encouraging, say what was missing).`;
}
