import { z } from 'zod';

export type ArtifactType = 'practice_test' | 'mock_exam' | 'study_notes' | 'last_night_notes';

const nonEmpty = z.string().trim().min(1);

/** Structural schema only; semantic rules (pattern match, passage refs, counts) live in validate.ts. */
export const QuestionSchema = z.object({
  id: nonEmpty,
  type: z.enum(['mcq', 'short', 'long', 'case']),
  prompt: nonEmpty,
  /**
   * Four options (mcq only). Modelled as a length-4 array so it converts to plain JSON Schema. Empty strings
   * are tolerated here because models pad non-mcq questions with placeholders; validate.ts rejects them for mcq
   * and resolvePassageRefs drops them for everything else.
   */
  options: z.array(z.string()).length(4).optional(),
  correctIndex: z.number().int().min(0).max(3).optional(),
  modelAnswer: nonEmpty.optional(),
  rubric: z.array(nonEmpty).min(2).max(5).optional(),
  marks: z.number().positive(),
  chapterId: nonEmpty,
  passageRefs: z.array(z.string()),
});

export const PracticeTestSchema = z.object({
  title: nonEmpty,
  questions: z.array(QuestionSchema),
});

export const MockExamSchema = z.object({
  title: nonEmpty,
  patternKey: nonEmpty,
  durationMinutes: z.number().int().positive(),
  sections: z.array(z.object({ key: nonEmpty, title: nonEmpty, questions: z.array(QuestionSchema) })),
});

export const NotesSchema = z.object({
  title: nonEmpty,
  sections: z.array(
    z.object({ heading: nonEmpty, bodyMarkdown: nonEmpty, chapterId: nonEmpty, passageRefs: z.array(z.string()) }),
  ),
});

export type Question = z.infer<typeof QuestionSchema>;
export type PracticeTest = z.infer<typeof PracticeTestSchema>;
export type MockExam = z.infer<typeof MockExamSchema>;
export type Notes = z.infer<typeof NotesSchema>;

export type StoredQuestion = Question & { chunkIds: string[] };
export type StoredNotesSection = Notes['sections'][number] & { chunkIds: string[] };
export type Sources = Record<string, { itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number }>;

type WithChunkIds<T> = T extends { questions: Question[] }
  ? Omit<T, 'questions'> & { questions: StoredQuestion[] }
  : T extends { sections: { questions: Question[] }[] }
    ? Omit<T, 'sections'> & { sections: (Omit<T['sections'][number], 'questions'> & { questions: StoredQuestion[] })[] }
    : T extends { sections: Notes['sections'] }
      ? Omit<T, 'sections'> & { sections: StoredNotesSection[] }
      : never;

export type StoredContent<T extends PracticeTest | MockExam | Notes = PracticeTest | MockExam | Notes> = WithChunkIds<T> & {
  sources: Sources;
};
