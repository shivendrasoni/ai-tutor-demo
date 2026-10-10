import { describe, expect, it } from 'vitest';
import type { ChunkHit } from '@/modules/content';
import type { ExamPatternRow } from '@/modules/studytools/patterns';
import { buildGeneratorPrompt, buildGraderPrompt, formatPassages } from '@/modules/studytools/prompts';

const hits: ChunkHit[] = [1, 2, 3].map((n) => ({
  chunkId: `c${n}`, contentItemId: 'ci', itemTitle: 'Bio', subjectId: 's', subjectName: 'Biology',
  chapterId: 'ch', chapterTitle: `Chapter ${n}`, pageStart: n, pageEnd: n + 1, text: `text ${n}`, similarity: 1,
}));
const chapters = [{ id: '00000000-0000-4000-8000-0000000000c1', title: 'Cells' }, { id: '00000000-0000-4000-8000-0000000000c2', title: 'Plants' }];
const junior50: ExamPatternRow = {
  id: 'p', key: 'junior_50', name: 'Junior 50', gradeMin: 5, gradeMax: 8, durationMinutes: 120,
  sections: [
    { key: 'A', title: 'Objective', questionType: 'mcq', count: 10, marksEach: 1 },
    { key: 'B', title: 'Short', questionType: 'short', count: 10, marksEach: 2 },
    { key: 'C', title: 'Long', questionType: 'long', count: 4, marksEach: 5 },
  ],
};

describe('prompts', () => {
  it('formatPassages labels P1..Pn with chapter and pages, blank line between', () => {
    const f = formatPassages(hits);
    expect(f).toContain('[P1] Chapter 1, p.1–2\ntext 1');
    expect(f).toContain(`[P${hits.length}]`);
    expect(f.split('\n\n')).toHaveLength(3);
  });
  it('mock exam prompt states the exact pattern and chapter ids', () => {
    const p = buildGeneratorPrompt({ type: 'mock_exam', grade: 8, chapters, pattern: junior50 });
    expect(p).toMatch(/Section A.*10.*mcq.*1 mark/is);
    expect(p).toMatch(/Section C.*4.*long.*5 marks/is);
    expect(p).toContain('junior_50');
    expect(p).toContain('120');
    for (const c of chapters) expect(p).toContain(c.id);
    expect(p).toMatch(/P<n>/);
    expect(p).not.toContain('text 1');
  });
  it('practice prompt states the count, 60% MCQ and marks', () => {
    const p = buildGeneratorPrompt({ type: 'practice_test', grade: 7, chapters, questionCount: 12 });
    expect(p).toMatch(/exactly 12 questions/i);
    expect(p).toMatch(/60%/);
    expect(p).toMatch(/mcq.*1 mark/is);
    expect(p).toMatch(/short.*2 marks/is);
  });
  it('notes prompts state the section and word limits', () => {
    for (const type of ['study_notes', 'last_night_notes'] as const) {
      const p = buildGeneratorPrompt({ type, grade: 7, chapters });
      expect(p).toMatch(/at most 2 sections per chapter/i);
      expect(p).toMatch(/120 words/);
      for (const c of chapters) expect(p).toContain(c.title);
    }
  });
  it('grader prompt contains answer, model answer, rubric, and marks', () => {
    const p = buildGraderPrompt(
      { prompt: 'Why is the sky blue?', type: 'short', marks: 3, modelAnswer: 'Rayleigh scattering', rubric: ['mentions scattering', 'mentions wavelength'] },
      'because of light',
    );
    for (const s of ['Why is the sky blue?', 'Rayleigh scattering', 'mentions scattering', 'mentions wavelength', 'because of light', '3']) expect(p).toContain(s);
    expect(p).toMatch(/60 words/);
  });
  it('grader prompt marks an empty answer', () => {
    expect(buildGraderPrompt({ prompt: 'q', type: 'short', marks: 2, modelAnswer: 'm', rubric: ['a', 'b'] }, '')).toMatch(/no answer/i);
  });
});
