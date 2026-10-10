import { generateText, Output, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockModel } from '@/modules/tutor/models/mock';
import { ModelRegistry } from '@/modules/tutor/models/registry';
import { computeCost } from '@/modules/tutor/models/pricing';
import { llmModel } from '@/modules/tutor/config';
import { MockExamSchema, NotesSchema, PracticeTestSchema } from '@/modules/studytools/schemas';
import { generatedSchemaFor } from '@/modules/studytools/validate';
import { buildGeneratorPrompt, buildGraderPrompt, formatPassages } from '@/modules/studytools/prompts';
import type { ExamPatternRow } from '@/modules/studytools/patterns';
import type { ChunkHit } from '@/modules/content';
import { buildInstructions } from '@/modules/tutor/prompt';
import { SEED_SKILLS } from '@/modules/tutor/skills';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';

const instr = (key: string) => SEED_SKILLS.find((s) => s.key === key)!.instructions;
const system = (key: string) => buildInstructions({ skillInstructions: instr(key), grade: 8, schoolName: 'Sunrise', outOfSyllabus: false });

const PASSAGE =
  '[1] Bio 8 · Photosynthesis · p. 3–4\nPlants make their own food using sunlight, water and carbon dioxide. This process is called photosynthesis.';
const searchTool = tool({ description: 'search', inputSchema: z.object({ query: z.string() }), execute: async () => PASSAGE });

const hit = (i: number, chapterId: string, chapterTitle: string): ChunkHit => ({
  chunkId: `k${i}`, contentItemId: 'ci', itemTitle: 'Book', subjectId: 's', subjectName: 'Maths', chapterId, chapterTitle,
  pageStart: i, pageEnd: i + 1, text: `Passage ${i} says that topic ${i} matters. It has a second sentence too.`, similarity: 1,
});
const CH1 = '00000000-0000-4000-8000-0000000000c1';
const CH2 = '00000000-0000-4000-8000-0000000000c2';
const hits = [hit(1, CH1, 'Algebra'), hit(2, CH1, 'Algebra'), hit(3, CH2, 'Geometry')];
const chapters = [{ id: CH1, title: 'Algebra' }, { id: CH2, title: 'Geometry' }];
const ctxBase = { chapterIds: [CH1, CH2], passageCount: hits.length };

async function structured<T>(model: ReturnType<typeof createMockModel>, schema: z.ZodType<T>, prompt: string, context: string) {
  const res = await generateText({ model, system: 'You write things.', prompt: `${prompt}\n\nPassages:\n${context}`, output: Output.object({ schema }), maxRetries: 0 });
  return res;
}

describe('mock chat model', () => {
  it('calls search_curriculum first, then answers from the passage and cites [1]', async () => {
    const model = createMockModel('standard');
    const result = streamText({
      model, system: system('explain'), prompt: 'What is photosynthesis?', tools: { search_curriculum: searchTool },
      stopWhen: ({ steps }) => steps.length >= 4,
    });
    const deltas: string[] = [];
    for await (const d of result.textStream) deltas.push(d);
    const text = deltas.join('');
    expect(deltas.length).toBeGreaterThan(1); // streamed in pieces
    expect(text).toContain('[1]');
    expect(text).toContain('Plants make their own food');
    expect((await result.steps).length).toBe(2);
    expect((await result.steps)[0]!.toolCalls[0]).toMatchObject({ toolName: 'search_curriculum', input: { query: 'What is photosynthesis?' } });
    expect((await result.usage).totalTokens).toBeGreaterThan(0);
  });

  it('socratic skill answers with a guiding question instead of the answer', async () => {
    const result = streamText({
      model: createMockModel('standard'), system: system('socratic'), prompt: 'What is photosynthesis?', tools: { search_curriculum: searchTool },
      stopWhen: ({ steps }) => steps.length >= 4,
    });
    const text = await result.text;
    expect(text.trim().endsWith('?')).toBe(true);
    expect(text).toContain('[1]');
    expect(text).not.toContain('Plants make their own food');
  });

  it('says so when search finds nothing and does not cite', async () => {
    const empty = tool({ description: 'search', inputSchema: z.object({ query: z.string() }), execute: async () => 'No matching passages found.' });
    const { text } = await generateText({ model: createMockModel('standard'), system: system('explain'), prompt: 'zzz', tools: { search_curriculum: empty }, stopWhen: ({ steps }) => steps.length >= 4 });
    expect(text).toContain('This goes beyond your textbook');
    expect(text).not.toContain('[1]');
  });

  it('answers directly when no search tool is offered', async () => {
    const { text, steps } = await generateText({ model: createMockModel('standard'), system: system('explain'), prompt: 'hello' });
    expect(steps).toHaveLength(1);
    expect(text.length).toBeGreaterThan(0);
  });

  it('is deterministic and reports fixed usage', async () => {
    const run = () => generateText({ model: createMockModel('standard'), system: system('explain'), prompt: 'hello' });
    const [a, b] = [await run(), await run()];
    expect(a.text).toBe(b.text);
    expect(a.usage.inputTokens).toBe(b.usage.inputTokens);
    expect(a.usage.outputTokens).toBeGreaterThan(0);
  });
});

describe('mock structured output (validated against the real study schemas)', () => {
  it('practice test: exact count, ~60% mcq, valid refs and chapters', async () => {
    const ctx = { ...ctxBase, type: 'practice_test' as const, questionCount: 7 };
    const prompt = buildGeneratorPrompt({ type: 'practice_test', grade: 8, chapters, questionCount: 7 });
    const { output } = await structured(createMockModel('standard'), generatedSchemaFor('practice_test', ctx), prompt, formatPassages(hits));
    const t = PracticeTestSchema.parse(output);
    expect(t.questions).toHaveLength(7);
    expect(t.questions.filter((q) => q.type === 'mcq')).toHaveLength(5);
  });

  it('mock exam: follows the pattern exactly (sections, types, marks, duration)', async () => {
    const pattern: ExamPatternRow = {
      id: 'p', key: 'custom_pat', name: 'Custom', gradeMin: 1, gradeMax: 12, durationMinutes: 90,
      sections: [
        { key: 'A', title: 'Objective', questionType: 'mcq', count: 4, marksEach: 1 },
        { key: 'B', title: 'Short', questionType: 'short', count: 3, marksEach: 2 },
        { key: 'C', title: 'Long', questionType: 'long', count: 2, marksEach: 5 },
        { key: 'D', title: 'Case', questionType: 'case', count: 1, marksEach: 4 },
      ],
    };
    const ctx = { ...ctxBase, type: 'mock_exam' as const, pattern };
    const prompt = buildGeneratorPrompt({ type: 'mock_exam', grade: 8, chapters, pattern });
    const { output } = await structured(createMockModel('advanced'), generatedSchemaFor('mock_exam', ctx), prompt, formatPassages(hits));
    const m = MockExamSchema.parse(output);
    expect(m.patternKey).toBe('custom_pat');
    expect(m.durationMinutes).toBe(90);
    expect(m.sections.map((s) => [s.key, s.questions.length])).toEqual([['A', 4], ['B', 3], ['C', 2], ['D', 1]]);
  });

  it.each(['study_notes', 'last_night_notes'] as const)('%s: sections per chapter within limits', async (type) => {
    const ctx = { ...ctxBase, type };
    const prompt = buildGeneratorPrompt({ type, grade: 8, chapters });
    const { output } = await structured(createMockModel('standard'), generatedSchemaFor(type, ctx), prompt, formatPassages(hits));
    const n = NotesSchema.parse(output);
    expect(n.sections.map((s) => s.chapterId).sort()).toEqual([CH1, CH2]);
    expect(n.sections[0]!.bodyMarkdown).toContain('Passage 1');
  });

  it('grader: half marks plus short feedback', async () => {
    const schema = z.object({ score: z.number(), feedback: z.string() });
    const prompt = buildGraderPrompt({ prompt: 'Explain.', type: 'short', marks: 3, modelAnswer: 'Because.', rubric: ['a', 'b'] }, 'my answer');
    const { output } = await structured(createMockModel('standard'), schema, prompt, '');
    expect(output.score).toBe(1.5);
    expect(output.feedback.split(/\s+/).length).toBeLessThanOrEqual(60);
  });

  it('falls back to a generic JSON-schema filler for unknown schemas', async () => {
    const schema = z.object({ name: z.string(), count: z.number().int().min(2), ok: z.boolean(), tags: z.array(z.string()).min(1), kind: z.enum(['x', 'y']) });
    const { output } = await structured(createMockModel('standard'), schema, 'anything', '');
    expect(schema.parse(output)).toBeTruthy();
    expect(output.kind).toBe('x');
  });
});

describe('registry, config and pricing wiring', () => {
  it('registry resolves mock/* with no key, outside mock mode too', () => {
    const m = new ModelRegistry().resolve('mock/advanced');
    expect(m).toMatchObject({ provider: 'mock', modelId: 'advanced', specificationVersion: 'v4' });
  });
  it('mock/* costs 0 instead of null; unknown real models stay null', () => {
    expect(computeCost('mock/standard', 1000, 1000)).toBe(0);
    expect(computeCost('openai/unknown', 1, 1)).toBeNull();
  });
  it('llmModel defaults to mock/<tier> only in mock mode; explicit LLM_* wins', async () => {
    const { vi } = await import('vitest');
    vi.stubEnv('LLM_STANDARD_MODEL', '');
    vi.stubEnv('LLM_ADVANCED_MODEL', '');
    vi.stubEnv('AI_MOCK', '1');
    expect(llmModel('standard')).toBe('mock/standard');
    expect(llmModel('advanced')).toBe('mock/advanced');
    vi.stubEnv('LLM_STANDARD_MODEL', 'openai/x');
    expect(llmModel('standard')).toBe('openai/x');
    vi.stubEnv('AI_MOCK', '0');
    vi.stubEnv('LLM_ADVANCED_MODEL', '');
    expect(llmModel('advanced')).toBeUndefined();
    vi.unstubAllEnvs();
  });
  it('study skill keys exist for the generators', () => {
    expect(STUDY_SKILLS.map((s) => s.key)).toContain('answer_grader');
  });
});
