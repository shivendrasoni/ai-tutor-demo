import type { z, ZodType } from 'zod';
import type { ChunkHit } from '@/modules/content';
import type { ExamPatternRow } from './patterns';
import {
  MockExamSchema,
  NotesSchema,
  PracticeTestSchema,
  type ArtifactType,
  type MockExam,
  type Notes,
  type PracticeTest,
  type Question,
  type Sources,
  type StoredContent,
} from './schemas';

export type ValidationCtx = {
  type: ArtifactType;
  chapterIds: string[];
  passageCount: number;
  questionCount?: number;
  pattern?: ExamPatternRow;
};
type Generated = PracticeTest | MockExam | Notes;

const MAX_NOTE_WORDS = 120;
const MAX_SECTIONS_PER_CHAPTER = 2;
const REF = /^P(\d+)$/;

const baseSchema = (type: ArtifactType): ZodType<Generated> =>
  (type === 'practice_test' ? PracticeTestSchema : type === 'mock_exam' ? MockExamSchema : NotesSchema) as ZodType<Generated>;

const words = (s: string): number => s.trim().split(/\s+/).length;

function checkRefs(label: string, chapterId: string, refs: string[], ctx: ValidationCtx, errors: string[]): void {
  if (!ctx.chapterIds.includes(chapterId)) errors.push(`${label}: chapterId ${chapterId} is not one of the selected chapters`);
  if (refs.length === 0) errors.push(`${label}: passageRefs must have at least one entry`);
  for (const ref of refs) {
    const m = REF.exec(ref);
    const n = m ? Number(m[1]) : NaN;
    if (!m || n < 1 || n > ctx.passageCount) errors.push(`${label}: passage ref "${ref}" must be P1..P${ctx.passageCount}`);
  }
}

function checkQuestion(q: Question, label: string, ctx: ValidationCtx, errors: string[]): void {
  checkRefs(label, q.chapterId, q.passageRefs, ctx, errors);
  if (q.type === 'mcq') {
    if (!q.options || q.options.some((o) => o.trim() === '')) errors.push(`${label}: mcq needs exactly 4 non-empty options`);
    if (q.correctIndex === undefined || q.correctIndex < 0 || q.correctIndex > 3) errors.push(`${label}: mcq needs correctIndex in 0..3`);
  } else {
    if (!q.modelAnswer) errors.push(`${label}: ${q.type} question needs a modelAnswer`);
    if (!q.rubric) errors.push(`${label}: ${q.type} question needs a rubric of 2-5 points`);
  }
}

function checkUniqueIds(questions: Question[], errors: string[]): void {
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q.id)) errors.push(`question id "${q.id}" is used more than once; ids must be unique`);
    seen.add(q.id);
  }
}

function checkPractice(v: PracticeTest, ctx: ValidationCtx, errors: string[]): void {
  if (ctx.questionCount !== undefined && v.questions.length !== ctx.questionCount)
    errors.push(`expected exactly ${ctx.questionCount} questions, got ${v.questions.length}`);
  v.questions.forEach((q, i) => {
    const label = `question ${q.id || i + 1}`;
    if (q.type !== 'mcq' && q.type !== 'short') errors.push(`${label}: type must be mcq or short, got ${q.type}`);
    else if (q.marks !== (q.type === 'mcq' ? 1 : 2)) errors.push(`${label}: marks must be ${q.type === 'mcq' ? 1 : 2} for ${q.type}, got ${q.marks}`);
    checkQuestion(q, label, ctx, errors);
  });
  checkUniqueIds(v.questions, errors);
}

function checkMock(v: MockExam, ctx: ValidationCtx, errors: string[]): void {
  const p = ctx.pattern;
  if (!p) {
    errors.push('internal: no exam pattern supplied for mock exam validation');
    return;
  }
  if (v.patternKey !== p.key) errors.push(`pattern: patternKey must be "${p.key}", got "${v.patternKey}"`);
  if (v.durationMinutes !== p.durationMinutes) errors.push(`duration: durationMinutes must be ${p.durationMinutes}, got ${v.durationMinutes}`);
  if (v.sections.length !== p.sections.length) errors.push(`pattern: expected ${p.sections.length} sections, got ${v.sections.length}`);
  p.sections.forEach((ps, i) => {
    const s = v.sections[i];
    if (!s) {
      errors.push(`section ${ps.key} is missing`);
      return;
    }
    if (s.key !== ps.key) errors.push(`section ${i + 1} must have key ${ps.key} (sections in pattern order), got ${s.key}`);
    if (s.questions.length !== ps.count) errors.push(`section ${ps.key}: expected ${ps.count} questions, got ${s.questions.length}`);
    for (const q of s.questions) {
      if (q.type !== ps.questionType) errors.push(`section ${ps.key}: question ${q.id} type must be ${ps.questionType}, got ${q.type}`);
      if (q.marks !== ps.marksEach) errors.push(`section ${ps.key}: question ${q.id} marks must be ${ps.marksEach}, got ${q.marks}`);
    }
  });
  const all = v.sections.flatMap((s) => s.questions);
  all.forEach((q) => checkQuestion(q, `question ${q.id}`, ctx, errors));
  checkUniqueIds(all, errors);
}

function checkNotes(v: Notes, ctx: ValidationCtx, errors: string[]): void {
  if (v.sections.length < 1) errors.push('notes need at least 1 section');
  v.sections.forEach((s, i) => checkRefs(`section ${i + 1} ("${s.heading}")`, s.chapterId, s.passageRefs, ctx, errors));
  if (ctx.type !== 'last_night_notes') return;
  const perChapter = new Map<string, number>();
  v.sections.forEach((s, i) => {
    perChapter.set(s.chapterId, (perChapter.get(s.chapterId) ?? 0) + 1);
    const n = words(s.bodyMarkdown);
    if (n > MAX_NOTE_WORDS) errors.push(`section ${i + 1} ("${s.heading}"): bodyMarkdown has ${n} words, max ${MAX_NOTE_WORDS}`);
  });
  for (const [chapterId, n] of perChapter)
    if (n > MAX_SECTIONS_PER_CHAPTER) errors.push(`chapter ${chapterId} has ${n} sections, max ${MAX_SECTIONS_PER_CHAPTER} per chapter`);
}

function semanticErrors(value: Generated, ctx: ValidationCtx): string[] {
  const errors: string[] = [];
  if (ctx.type === 'practice_test') checkPractice(value as PracticeTest, ctx, errors);
  else if (ctx.type === 'mock_exam') checkMock(value as MockExam, ctx, errors);
  else checkNotes(value as Notes, ctx, errors);
  return errors;
}

const issueLine = (i: z.core.$ZodIssue): string => `${i.path.join('.') || 'value'}: ${i.message}`;

export function validateGenerated(
  raw: unknown,
  ctx: ValidationCtx,
): { ok: true; value: Generated } | { ok: false; errors: string[] } {
  const parsed = baseSchema(ctx.type).safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issueLine) };
  const errors = semanticErrors(parsed.data, ctx);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parsed.data };
}

/** Structural schema plus a superRefine reporting every semantic error; the base stays a plain object schema. */
export function generatedSchemaFor(type: ArtifactType, ctx: ValidationCtx): ZodType<Generated> {
  return baseSchema(type).superRefine((value, refinement) => {
    for (const message of semanticErrors(value, { ...ctx, type })) refinement.addIssue({ code: 'custom', message });
  });
}

/** Maps `P{n}` to `hits[n-1].chunkId`, adds `chunkIds` to each question/section, builds `sources`. */
export function resolvePassageRefs<T extends Generated>(
  value: T,
  hits: ChunkHit[],
): { content: StoredContent<T>; sourceChunkIds: string[] } {
  const sources: Sources = {};
  const used = new Set<string>();
  const resolve = (refs: string[]): string[] => {
    const ids: string[] = [];
    for (const ref of refs) {
      const hit = hits[Number(REF.exec(ref)?.[1]) - 1];
      if (!hit) throw new Error(`unresolvable passage ref ${ref}`);
      sources[hit.chunkId] = { itemTitle: hit.itemTitle, chapterTitle: hit.chapterTitle, pageStart: hit.pageStart, pageEnd: hit.pageEnd };
      used.add(hit.chunkId);
      if (!ids.includes(hit.chunkId)) ids.push(hit.chunkId);
    }
    return ids;
  };
  const withIds = <X extends { passageRefs: string[]; type?: string }>(x: X) => {
    // Models pad non-mcq questions with placeholder options/correctIndex; they must not reach storage or the UI.
    const { options: _options, correctIndex: _correctIndex, ...rest } = x as X & { options?: unknown; correctIndex?: unknown };
    return { ...(x.type === undefined || x.type === 'mcq' ? x : rest), chunkIds: resolve(x.passageRefs) };
  };
  const v = value as Record<string, unknown>;
  let body: Record<string, unknown>;
  if ('questions' in value) body = { ...v, questions: (value as PracticeTest).questions.map(withIds) };
  else if (value.sections.length > 0 && 'questions' in value.sections[0])
    body = { ...v, sections: (value as MockExam).sections.map((s) => ({ ...s, questions: s.questions.map(withIds) })) };
  else body = { ...v, sections: (value as Notes).sections.map(withIds) };
  return { content: { ...body, sources } as StoredContent<T>, sourceChunkIds: [...used] };
}
