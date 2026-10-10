import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { artifacts, skills } from '@/db/schema';
import type { Actor } from '@/modules/tenancy/actor';
import { activate } from './tutor';

/** Sets the student's profile to `active` (platform context). Delegates to the tutor helper. */
export const activateStudent = (actor: Actor): Promise<void> => activate(actor);

/** Returns (creating once) a generator skill row for artifact fixtures. */
async function fixtureSkillId(key = 'practice_test_generator'): Promise<string> {
  return withPlatform(async (tx) => {
    const [found] = await tx.select({ id: skills.id }).from(skills).where(eq(skills.key, key));
    if (found) return found.id;
    const [row] = await tx
      .insert(skills)
      .values({ key, name: key, kind: 'generator', instructions: 'fixture' })
      .returning({ id: skills.id });
    return row.id;
  });
}

type ArtifactInsert = typeof artifacts.$inferInsert;

/** Inserts an artifact directly (platform context). Defaults to a ready practice test with content. */
export async function insertArtifact(
  schoolId: string,
  studentId: string,
  subjectId: string,
  over: Partial<ArtifactInsert> = {},
): Promise<typeof artifacts.$inferSelect> {
  const skillId = over.skillId ?? (await fixtureSkillId());
  const [row] = await withPlatform((tx) =>
    tx
      .insert(artifacts)
      .values({
        schoolId,
        studentId,
        skillId,
        type: 'practice_test',
        subjectId,
        status: 'ready',
        params: { chapterTitles: {} },
        content: { questions: [] },
        ...over,
      })
      .returning(),
  );
  return row;
}

// ---- content fixtures (pure; no DB) ----
import type { ExamPatternRow } from '@/modules/studytools/patterns';
import type { MockExam, Notes, PracticeTest, Question } from '@/modules/studytools/schemas';

export const CH = '00000000-0000-4000-8000-0000000000c1';
export const OTHER_CH = '00000000-0000-4000-8000-0000000000c2';

export const mcq = (over: Record<string, unknown> = {}): Question =>
  ({
    id: 'm',
    type: 'mcq',
    prompt: 'Which one?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    marks: 1,
    chapterId: CH,
    passageRefs: ['P1'],
    ...over,
  }) as Question;

export const short = (over: Record<string, unknown> = {}): Question =>
  ({
    id: 's',
    type: 'short',
    prompt: 'Explain.',
    modelAnswer: 'Because.',
    rubric: ['point one', 'point two'],
    marks: 2,
    chapterId: CH,
    passageRefs: ['P1'],
    ...over,
  }) as Question;

/** n questions: first ceil(0.6n) MCQ, rest short. `over.q` selects the question to patch; other keys are patched onto it. */
export function practice(n: number, over: Record<string, unknown> = {}): PracticeTest {
  const nMcq = Math.ceil(n * 0.6);
  const questions = Array.from({ length: n }, (_, i) =>
    i < nMcq ? mcq({ id: `q${i}`, passageRefs: [`P${(i % 12) + 1}`] }) : short({ id: `q${i}`, passageRefs: [`P${(i % 12) + 1}`] }),
  );
  const { q, ...patch } = over;
  if (typeof q === 'number' && questions[q]) Object.assign(questions[q], patch);
  return { title: 'Practice', questions };
}

type MockOver = {
  drop?: string;
  marks?: [string, number];
  type?: [string, Question['type']];
  swap?: [string, string];
  durationMinutes?: number;
  patternKey?: string;
};
const questionOfType = (t: Question['type'], id: string, marks: number): Question =>
  t === 'mcq' ? mcq({ id, marks }) : short({ id, type: t, marks });

export function mockFor(pattern: ExamPatternRow, over: MockOver = {}): MockExam {
  let sections = pattern.sections.map((s) => {
    let count = s.count;
    if (over.drop === s.key) count -= 1;
    const type = over.type?.[0] === s.key ? over.type[1] : s.questionType;
    const marks = over.marks?.[0] === s.key ? over.marks[1] : s.marksEach;
    return {
      key: s.key,
      title: s.title,
      questions: Array.from({ length: count }, (_, i) => questionOfType(type, `${s.key}${i + 1}`, marks)),
    };
  });
  if (over.swap) {
    const [a, b] = over.swap.map((k) => sections.findIndex((s) => s.key === k));
    sections = sections.slice();
    [sections[a], sections[b]] = [sections[b], sections[a]];
  }
  return {
    title: 'Mock',
    patternKey: over.patternKey ?? pattern.key,
    durationMinutes: over.durationMinutes ?? pattern.durationMinutes,
    sections,
  };
}

export const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

/** `perChapter` sections for each chapter id; bodies of `bodyWords` words. */
export function notes(opts: { chapters?: string[]; perChapter?: number; bodyWords?: number } = {}): Notes {
  const { chapters = [CH], perChapter = 1, bodyWords = 20 } = opts;
  return {
    title: 'Notes',
    sections: chapters.flatMap((chapterId, c) =>
      Array.from({ length: perChapter }, (_, i) => ({
        heading: `H${c}-${i}`,
        bodyMarkdown: words(bodyWords),
        chapterId,
        passageRefs: ['P1'],
      })),
    ),
  };
}

// ---- Task 3: scripted LLM models ----
import { vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { configureTutor, resetTutorConfig } from '@/modules/tutor/deps';
import { ModelRegistry } from '@/modules/tutor/models/registry';

const usageOf = (i: number, o: number) => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});

/** ai@7 (spec v4) model: each `doGenerate` returns the next scripted item as JSON text, or throws an Error item. The last item repeats. */
export function mockModel(script: Array<object | Error>): MockLanguageModelV4 {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const item = script[Math.min(n++, script.length - 1)]!;
      if (item instanceof Error) throw item;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(item) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usageOf(10, 5),
        warnings: [],
      };
    },
  });
}

/** The only place that wires models for study tests. Undo with `resetStudyMocks()` in afterEach. */
export function useMockModels(m: { standard?: MockLanguageModelV4; advanced?: MockLanguageModelV4 } = {}): void {
  vi.stubEnv('LLM_STANDARD_MODEL', 'mock/standard');
  vi.stubEnv('LLM_ADVANCED_MODEL', 'mock/advanced');
  const registry = new ModelRegistry();
  if (m.standard) registry.override('mock/standard', m.standard as never);
  if (m.advanced) registry.override('mock/advanced', m.advanced as never);
  configureTutor({ registry });
}

export function resetStudyMocks(): void {
  resetTutorConfig();
  vi.unstubAllEnvs();
}

// ---- Task 4: queue seam and content fixtures ----
import { afterEach, beforeEach } from 'vitest';
import { asc, inArray } from 'drizzle-orm';
import { chunks as chunksTable, contentChapters } from '@/db/schema';
import { setStudyQueue, type GenerateJob, type GradeJob, type StudyQueue } from '@/modules/studytools/queue';
import { seedChunks, seedItem } from './content';
import type { SchoolSeed } from './db';

export class RecordingQueue implements StudyQueue {
  generate: GenerateJob[] = [];
  grade: GradeJob[] = [];
  /** When set, the next enqueue call throws this error (then clears). */
  failNext: Error | null = null;
  private maybeFail(): void {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }
  async enqueueGenerate(d: GenerateJob): Promise<void> {
    this.maybeFail();
    this.generate.push(d);
  }
  async enqueueGrade(d: GradeJob[]): Promise<void> {
    this.maybeFail();
    this.grade.push(...d);
  }
}

/** Installs a fresh RecordingQueue per test (beforeEach) and removes it afterwards. Call at the top of a describe/file. */
export function useRecordingQueue(): { current: RecordingQueue } {
  const holder = { current: new RecordingQueue() };
  beforeEach(() => {
    holder.current = new RecordingQueue();
    setStudyQueue(holder.current);
  });
  afterEach(() => setStudyQueue(null));
  return holder;
}

/** A ready school-scope grade-8 item with chapters and FakeEmbedder-vector chunks, via the content test helpers. */
export async function seedStudyContent(
  school: SchoolSeed,
  o: { chapters?: number; chunksPerChapter?: number } = {},
): Promise<{ subjectId: string; chapterIds: string[]; chunkIds: string[] }> {
  const { chapters = 3, chunksPerChapter = 4 } = o;
  const item = await seedItem(school, { grade: 8, scope: 'school', ingestStatus: 'ready' });
  await seedChunks(
    item.id,
    Array.from({ length: chapters }, (_, c) => ({
      title: `Chapter ${c + 1}`,
      texts: Array.from({ length: chunksPerChapter }, (_, k) => `Chapter ${c + 1} passage ${k + 1} about topic ${c + 1}.`),
    })),
  );
  return withPlatform(async (tx) => {
    const chs = await tx.select({ id: contentChapters.id }).from(contentChapters)
      .where(inArray(contentChapters.contentItemId, [item.id])).orderBy(asc(contentChapters.ordinal));
    const cks = await tx.select({ id: chunksTable.id }).from(chunksTable)
      .where(inArray(chunksTable.contentItemId, [item.id])).orderBy(asc(chunksTable.ordinal));
    return { subjectId: school.subjectId, chapterIds: chs.map((c) => c.id), chunkIds: cks.map((c) => c.id) };
  });
}
