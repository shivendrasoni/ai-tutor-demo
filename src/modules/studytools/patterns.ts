import { asc, eq, and, lte, gte } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { examPatterns } from '@/db/schema';

export type PatternSection = {
  key: string;
  title: string;
  questionType: 'mcq' | 'short' | 'long' | 'case';
  count: number;
  marksEach: number;
};
export type ExamPatternRow = {
  id: string;
  key: string;
  name: string;
  gradeMin: number;
  gradeMax: number;
  durationMinutes: number;
  sections: PatternSection[];
};

const toRow = (r: typeof examPatterns.$inferSelect): ExamPatternRow => ({ ...r, sections: r.sections as PatternSection[] });

/** Patterns that apply to `grade` (global table, read through the platform context). */
export async function listExamPatterns(grade: number): Promise<ExamPatternRow[]> {
  const rows = await withPlatform((tx) =>
    tx
      .select()
      .from(examPatterns)
      .where(and(lte(examPatterns.gradeMin, grade), gte(examPatterns.gradeMax, grade)))
      .orderBy(asc(examPatterns.key)),
  );
  return rows.map(toRow);
}

export async function getPattern(key: string): Promise<ExamPatternRow | null> {
  const [row] = await withPlatform((tx) => tx.select().from(examPatterns).where(eq(examPatterns.key, key)));
  return row ? toRow(row) : null;
}

export const defaultPatternKey = (grade: number): 'standard_80' | 'junior_50' => (grade >= 9 ? 'standard_80' : 'junior_50');
