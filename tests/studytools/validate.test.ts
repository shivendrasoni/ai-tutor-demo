import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodSchema } from 'ai';
import type { ChunkHit } from '@/modules/content';
import type { ExamPatternRow } from '@/modules/studytools/patterns';
import { generatedSchemaFor, resolvePassageRefs, validateGenerated, type ValidationCtx } from '@/modules/studytools/validate';
import { CH, OTHER_CH, mockFor, notes, practice, words } from '../helpers/study';

const std80: ExamPatternRow = {
  id: 'p1',
  key: 'standard_80',
  name: 'Standard 80',
  gradeMin: 9,
  gradeMax: 12,
  durationMinutes: 180,
  sections: [
    { key: 'A', title: 'A', questionType: 'mcq', count: 20, marksEach: 1 },
    { key: 'B', title: 'B', questionType: 'short', count: 5, marksEach: 2 },
    { key: 'C', title: 'C', questionType: 'short', count: 6, marksEach: 3 },
    { key: 'D', title: 'D', questionType: 'long', count: 4, marksEach: 5 },
    { key: 'E', title: 'E', questionType: 'case', count: 3, marksEach: 4 },
  ],
};

const base = { chapterIds: [CH], passageCount: 12 };
const ctx = (type: ValidationCtx['type']): ValidationCtx => ({ type, ...base, questionCount: type === 'practice_test' ? 10 : undefined });
const mockCtx = (pattern: ExamPatternRow): ValidationCtx => ({ type: 'mock_exam', ...base, pattern });

const hits: ChunkHit[] = Array.from({ length: 12 }, (_, i) => ({
  chunkId: `chunk-${i + 1}`,
  contentItemId: 'item',
  itemTitle: `Book ${i + 1}`,
  subjectId: 's',
  subjectName: 'Sci',
  chapterId: CH,
  chapterTitle: `Chapter ${i + 1}`,
  pageStart: i + 1,
  pageEnd: i + 2,
  text: 't',
  similarity: 1,
}));

describe('validateGenerated: practice test', () => {
  it.each([
    ['valid practice test', practice(10), true],
    ['wrong question count', practice(9), false],
    ['mcq correctIndex 4', practice(10, { q: 0, correctIndex: 4 }), false],
    ['mcq with 3 options', practice(10, { q: 0, options: ['a', 'b', 'c'] }), false],
    ['short with 1 rubric point', practice(10, { q: 9, rubric: ['x'] }), false],
    ['unknown passage P99', practice(10, { q: 0, passageRefs: ['P99'] }), false],
    ['malformed passage ref', practice(10, { q: 0, passageRefs: ['p1'] }), false],
    ['empty passageRefs', practice(10, { q: 0, passageRefs: [] }), false],
    ['chapterId not selected', practice(10, { q: 0, chapterId: OTHER_CH }), false],
    ['duplicate ids', practice(10, { q: 1, id: 'q0' }), false],
    ['marks 0', practice(10, { q: 0, marks: 0 }), false],
    ['mcq worth 2', practice(10, { q: 0, marks: 2 }), false],
    ['short worth 1', practice(10, { q: 9, marks: 1 }), false],
    ['long type not allowed', practice(10, { q: 9, type: 'long' }), false],
    ['short without modelAnswer', practice(10, { q: 9, modelAnswer: undefined }), false],
    ['mcq without options', practice(10, { q: 0, options: undefined }), false],
    ['empty option string', practice(10, { q: 0, options: ['a', '', 'c', 'd'] }), false],
  ])('%s', (_n, raw, ok) => expect(validateGenerated(raw, ctx('practice_test')).ok).toBe(ok));

  it('reports human-readable error lines', () => {
    const r = validateGenerated(practice(9), ctx('practice_test'));
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join(' ')).toMatch(/10/);
  });
});

describe('validateGenerated: mock exam', () => {
  it('accepts a mock exam that matches standard_80 exactly', () =>
    expect(validateGenerated(mockFor(std80), mockCtx(std80)).ok).toBe(true));

  it.each([
    ['count short by one in B', mockFor(std80, { drop: 'B' })],
    ['wrong marks in C', mockFor(std80, { marks: ['C', 2] })],
    ['wrong type in A', mockFor(std80, { type: ['A', 'short'] })],
    ['wrong duration', mockFor(std80, { durationMinutes: 150 })],
    ['wrong patternKey', mockFor(std80, { patternKey: 'junior_50' })],
    ['sections out of order', mockFor(std80, { swap: ['A', 'B'] })],
  ])('rejects mock exam: %s', (_n, raw) => {
    const r = validateGenerated(raw, mockCtx(std80));
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join(' ')).toMatch(/section|marks|type|duration|pattern/i);
  });

  it('rejects question ids duplicated across sections', () => {
    const raw = mockFor(std80);
    raw.sections[1].questions[0].id = raw.sections[0].questions[0].id;
    expect(validateGenerated(raw, mockCtx(std80)).ok).toBe(false);
  });
});

describe('validateGenerated: notes', () => {
  it('last-night notes: 2 sections per chapter pass, 3 fail', () => {
    expect(validateGenerated(notes({ perChapter: 2 }), ctx('last_night_notes')).ok).toBe(true);
    expect(validateGenerated(notes({ perChapter: 3 }), ctx('last_night_notes')).ok).toBe(false);
  });
  it('last-night notes: 120-word body passes, 121 fails', () => {
    expect(validateGenerated(notes({ bodyWords: 120 }), ctx('last_night_notes')).ok).toBe(true);
    expect(validateGenerated(notes({ bodyWords: 121 }), ctx('last_night_notes')).ok).toBe(false);
  });
  it('study notes may be long but need >= 1 section', () => {
    expect(validateGenerated(notes({ perChapter: 3, bodyWords: 300 }), ctx('study_notes')).ok).toBe(true);
    expect(validateGenerated({ title: 'x', sections: [] }, ctx('study_notes')).ok).toBe(false);
  });
  it('notes section with unknown chapter or passage fails', () => {
    expect(validateGenerated(notes({ chapters: [OTHER_CH] }), ctx('study_notes')).ok).toBe(false);
    const n = notes();
    n.sections[0].passageRefs = ['P13'];
    expect(validateGenerated(n, ctx('study_notes')).ok).toBe(false);
  });
  it('rejects non-object input', () => expect(validateGenerated('nope', ctx('study_notes')).ok).toBe(false));
  it('body words helper sanity', () => expect(words(3).split(' ')).toHaveLength(3));
});

describe('generatedSchemaFor', () => {
  it('fails a mock exam missing section B with an issue mentioning section B', () => {
    const r = generatedSchemaFor('mock_exam', mockCtx(std80)).safeParse(mockFor(std80, { drop: 'B' }));
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join(' ')).toMatch(/section B/i);
  });
  it('passes a valid value and returns it', () => {
    const r = generatedSchemaFor('practice_test', ctx('practice_test')).safeParse(practice(10));
    expect(r.success).toBe(true);
  });
  it.each(['practice_test', 'mock_exam', 'study_notes', 'last_night_notes'] as const)(
    '%s schema converts to JSON schema for structured output',
    (type) => {
      const schema = generatedSchemaFor(type, { ...ctx(type), pattern: std80 });
      const json = z.toJSONSchema(schema as z.ZodType, { io: 'input' });
      expect(json.type).toBe('object');
      expect(() => zodSchema(schema as z.ZodType).jsonSchema).not.toThrow();
    },
  );
});

describe('resolvePassageRefs', () => {
  it('maps P-numbers to chunk ids and builds sources', () => {
    const { content, sourceChunkIds } = resolvePassageRefs(practice(10), hits);
    expect(content.questions[0].chunkIds).toEqual([hits[0].chunkId]);
    expect(content.sources[hits[0].chunkId]).toEqual({
      itemTitle: hits[0].itemTitle,
      chapterTitle: hits[0].chapterTitle,
      pageStart: hits[0].pageStart,
      pageEnd: hits[0].pageEnd,
    });
    expect(new Set(sourceChunkIds).size).toBe(sourceChunkIds.length);
    expect(sourceChunkIds).toHaveLength(10);
  });
  it('resolves mock sections and notes, deduplicating', () => {
    const m = resolvePassageRefs(mockFor(std80), hits);
    expect(m.content.sections[0].questions[0].chunkIds).toEqual(['chunk-1']);
    expect(m.sourceChunkIds).toEqual(['chunk-1']);
    const n = notes();
    n.sections[0].passageRefs = ['P2', 'P2', 'P3'];
    const r = resolvePassageRefs(n, hits);
    expect(r.content.sections[0].chunkIds).toEqual(['chunk-2', 'chunk-3']);
    expect(r.sourceChunkIds).toEqual(['chunk-2', 'chunk-3']);
  });
});
