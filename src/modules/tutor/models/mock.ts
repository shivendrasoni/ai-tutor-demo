import type { LanguageModel } from 'ai';

type LanguageModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type LanguageModelV4CallOptions = Parameters<LanguageModelV4['doGenerate']>[0];
type LanguageModelV4StreamPart = Awaited<ReturnType<LanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
type LanguageModelV4Usage = Awaited<ReturnType<LanguageModelV4['doGenerate']>>['usage'];

/**
 * Deterministic stand-in for a real chat/structured model (provider `mock`, AI SDK v7 / spec v4), so the running
 * app works end to end with no API keys. It inspects the call options and behaves like the real thing:
 * - tools include `search_curriculum` and no tool result yet: one tool call with the student's message;
 * - a tool result is present: an answer built from the first passage, citing [1] (socratic skill: a guiding question);
 * - a JSON response format is requested: schema-valid JSON, from explicit generators for the known study schemas
 *   (practice test, mock exam, notes, grader) and a generic JSON-schema filler for anything else.
 * Output depends only on the input, and the usage numbers are fixed.
 */

type Tier = 'standard' | 'advanced';
type Json = Record<string, unknown>;
type Prompt = LanguageModelV4CallOptions['prompt'];

const SEARCH_TOOL = 'search_curriculum';
const NO_RESULTS = 'No matching passages found.';
const BEYOND = 'This goes beyond your textbook.';

const usage = (i: number, o: number): LanguageModelV4Usage => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});
const USAGE = { toolCall: usage(20, 5), text: usage(30, 15), json: usage(40, 30) };

// ---- prompt inspection ----

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text: string }).text) : '')).join('')
    : typeof content === 'string'
      ? content
      : '';

const systemText = (prompt: Prompt): string => prompt.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
const lastUserText = (prompt: Prompt): string => {
  for (let i = prompt.length - 1; i >= 0; i--) if (prompt[i]!.role === 'user') return textOf(prompt[i]!.content).trim();
  return '';
};

/** The text of the latest tool result, or null when the model has not seen one yet. */
function toolResultText(prompt: Prompt): string | null {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i]!;
    if (m.role !== 'tool') continue;
    for (const part of m.content) {
      if (part.type !== 'tool-result') continue;
      const out = part.output as { type: string; value?: unknown };
      if (out.type === 'text') return String(out.value);
      if (out.type === 'json') return typeof out.value === 'string' ? out.value : JSON.stringify(out.value);
      return '';
    }
  }
  return null;
}

const snippet = (text: string, maxWords: number): string => {
  const w = text.trim().split(/\s+/);
  return w.length <= maxWords ? w.join(' ') : `${w.slice(0, maxWords).join(' ')}…`;
};
const firstSentence = (text: string): string => snippet(text.trim().split(/(?<=[.!?])\s/)[0] ?? text, 30);

// ---- chat ----

type Passage = { n: number; text: string };
/** Parses search_curriculum output: `[n] Title · Chapter · p. a–b\ntext` blocks. */
function parseSearchResult(s: string): Passage[] {
  return s
    .split(/\n\n(?=\[\d+\] .+ · .+ · p\. )/)
    .map((block) => /^\[(\d+)\] [^\n]*\n([\s\S]*)$/.exec(block.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ n: Number(m[1]), text: m[2]!.trim() }));
}

function chatAnswer(prompt: Prompt): string {
  const result = toolResultText(prompt);
  const question = lastUserText(prompt);
  const passages = result ? parseSearchResult(result) : [];
  const socratic = /socratic/i.test(systemText(prompt));
  if (passages.length === 0) {
    if (result !== null)
      return `I could not find that in your textbook, but here is a general idea. ${BEYOND} Could you tell me which chapter you are studying?`;
    return socratic
      ? 'Good question. What do you already know about this topic?'
      : `Here is a short answer to "${snippet(question, 12)}". ${BEYOND} Ask me about a chapter in your books to see passages and sources.`;
  }
  const first = passages[0]!;
  if (socratic)
    return `Let's work this out together. Look at passage [${first.n}] in your textbook: in your own words, what is it mostly about?`;
  return `According to your textbook, ${firstSentence(first.text)} [${first.n}] Does that make sense, or should we try another example?`;
}

const chunk = (s: string, size = 12): string[] => Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size));

// ---- structured output ----

type Question = Json;
const REF_BLOCK = /^\[P(\d+)\] ([^\n]*?), p\.[^\n]*\n([\s\S]*?)(?=\n\n\[P\d+\] |$)/gm;
type PassageRef = { ref: string; chapterTitle: string; text: string };

function parsePassages(prompt: string): PassageRef[] {
  const body = prompt.slice(prompt.lastIndexOf('Passages:') + 'Passages:'.length).trimStart();
  return [...body.matchAll(REF_BLOCK)].map((m) => ({ ref: `P${m[1]}`, chapterTitle: m[2]!.trim(), text: m[3]!.trim() }));
}
const parseChapters = (prompt: string) => [...prompt.matchAll(/^- chapterId (\S+): (.*)$/gm)].map((m) => ({ id: m[1]!, title: m[2]!.trim() }));

/** Questions and notes round-robin over the chapters, citing a passage from that chapter when one exists. */
function makePicker(prompt: string) {
  const passages = parsePassages(prompt);
  const chapters = parseChapters(prompt);
  const fallback: PassageRef = { ref: 'P1', chapterTitle: '', text: 'This passage was not available.' };
  return (i: number) => {
    const chapter = chapters[i % Math.max(chapters.length, 1)] ?? { id: 'chapter', title: '' };
    const own = passages.filter((p) => p.chapterTitle === chapter.title);
    const pool = own.length ? own : passages;
    const passage = pool.length ? pool[Math.floor(i / Math.max(chapters.length, 1)) % pool.length]! : fallback;
    return { chapter, passage };
  };
}

function makeQuestion(id: string, type: string, marks: number, i: number, pick: ReturnType<typeof makePicker>): Question {
  const { chapter, passage } = pick(i);
  const fact = firstSentence(passage.text);
  const base = { id, type, marks, chapterId: chapter.id, passageRefs: [passage.ref] };
  if (type === 'mcq') {
    const correctIndex = i % 4;
    const distractors = ['It is not covered in the passage.', 'The opposite is stated in the passage.', 'None of these.'];
    const options = [...distractors.slice(0, correctIndex), fact, ...distractors.slice(correctIndex)];
    return { ...base, prompt: `Which statement matches your textbook (question ${i + 1})?`, options, correctIndex };
  }
  return {
    ...base,
    prompt: `Explain in your own words (question ${i + 1}): ${snippet(fact, 12)}`,
    modelAnswer: fact,
    rubric: ['Mentions the main idea from the passage', 'Explains it clearly in the student\'s own words'],
  };
}

function practiceTest(prompt: string): Json {
  const n = Number(/exactly (\d+) questions/.exec(prompt)?.[1] ?? 10);
  const pick = makePicker(prompt);
  const nMcq = Math.ceil(n * 0.6);
  return {
    title: 'Practice test (mock)',
    questions: Array.from({ length: n }, (_, i) => makeQuestion(`q${i + 1}`, i < nMcq ? 'mcq' : 'short', i < nMcq ? 1 : 2, i, pick)),
  };
}

function mockExam(prompt: string): Json {
  const pick = makePicker(prompt);
  let i = 0;
  const sections = [...prompt.matchAll(/^Section (\S+) \((.*)\): exactly (\d+) (\w+) questions, ([\d.]+) marks?\b/gm)].map((m) => ({
    key: m[1]!,
    title: m[2]!,
    questions: Array.from({ length: Number(m[3]) }, (_, k) => makeQuestion(`${m[1]}${k + 1}`, m[4]!, Number(m[5]), i++, pick)),
  }));
  return {
    title: 'Mock exam (mock)',
    patternKey: /patternKey "([^"]+)"/.exec(prompt)?.[1] ?? 'mock',
    durationMinutes: Number(/durationMinutes (\d+)/.exec(prompt)?.[1] ?? 60),
    sections,
  };
}

function notes(prompt: string): Json {
  const passages = parsePassages(prompt);
  const lastNight = /last-night/i.test(prompt);
  const chapters = parseChapters(prompt);
  return {
    title: lastNight ? 'Last-night revision (mock)' : 'Study notes (mock)',
    sections: chapters.map((c, i) => {
      const own = passages.filter((p) => p.chapterTitle === c.title);
      const used = (own.length ? own : passages.slice(i, i + 1)).slice(0, 2);
      return {
        heading: `${c.title}: key ideas`,
        bodyMarkdown: (used.length ? used : [{ text: 'Revise this chapter from your textbook.' }]).map((p) => `- ${snippet(p.text, 40)}`).join('\n'),
        chapterId: c.id,
        passageRefs: used.length ? used.map((p) => (p as PassageRef).ref) : ['P1'],
      };
    }),
  };
}

function grade(prompt: string): Json {
  const marks = Number(/Question \(([\d.]+) marks?\)/.exec(prompt)?.[1] ?? 1);
  return {
    score: Math.round(marks) / 2,
    feedback: 'Good effort, you earned about half the marks. Check the model answer and make sure you cover every rubric point.',
  };
}

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; const?: unknown; minimum?: number; maximum?: number; minItems?: number; anyOf?: Schema[]; oneOf?: Schema[]; minLength?: number };

/** Fallback for schemas the explicit generators do not know: the simplest value that satisfies the schema. */
function fill(s: Schema | undefined): unknown {
  if (!s) return 'mock';
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  const alt = s.anyOf ?? s.oneOf;
  if (alt?.length) return fill(alt[0]);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type) {
    case 'object':
      return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => s.required?.includes(k) ?? true).map(([k, v]) => [k, fill(v)]));
    case 'array':
      return Array.from({ length: Math.max(s.minItems ?? 0, 1) }, () => fill(s.items));
    case 'integer':
    case 'number':
      return Math.max(s.minimum ?? 0, Math.min(s.maximum ?? Infinity, s.minimum ?? 1));
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return 'mock'.padEnd(s.minLength ?? 0, 'x');
  }
}

function structured(prompt: Prompt, schema: Schema | undefined): Json {
  const text = lastUserText(prompt);
  const keys = Object.keys(schema?.properties ?? {});
  if (keys.includes('score') && keys.includes('feedback')) return grade(text);
  if (keys.includes('patternKey')) return mockExam(text);
  if (keys.includes('questions')) return practiceTest(text);
  if (keys.includes('sections')) return notes(text);
  return fill(schema) as Json;
}

// ---- the model ----

type Reply = { parts: LanguageModelV4StreamPart[]; content: Awaited<ReturnType<LanguageModelV4['doGenerate']>>['content']; finish: 'stop' | 'tool-calls'; usage: LanguageModelV4Usage };

function respond(o: LanguageModelV4CallOptions): Reply {
  if (o.responseFormat?.type === 'json') {
    const text = JSON.stringify(structured(o.prompt, o.responseFormat.schema as Schema | undefined));
    return { parts: [{ type: 'text-start', id: 't-0' }, { type: 'text-delta', id: 't-0', delta: text }, { type: 'text-end', id: 't-0' }], content: [{ type: 'text', text }], finish: 'stop', usage: USAGE.json };
  }
  const canSearch = o.tools?.some((t) => t.name === SEARCH_TOOL) ?? false;
  if (canSearch && toolResultText(o.prompt) === null) {
    const input = JSON.stringify({ query: lastUserText(o.prompt) });
    return {
      parts: [{ type: 'tool-call', toolCallId: 'mock-call-0', toolName: SEARCH_TOOL, input }],
      content: [{ type: 'tool-call', toolCallId: 'mock-call-0', toolName: SEARCH_TOOL, input }],
      finish: 'tool-calls',
      usage: USAGE.toolCall,
    };
  }
  const text = chatAnswer(o.prompt);
  return {
    parts: [{ type: 'text-start', id: 't-0' }, ...chunk(text).map((delta): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 't-0', delta })), { type: 'text-end', id: 't-0' }],
    content: [{ type: 'text', text }],
    finish: 'stop',
    usage: USAGE.text,
  };
}

export function createMockModel(modelId: Tier | string): LanguageModelV4 {
  const finishReason = (r: Reply) => (r.finish === 'stop' ? { unified: 'stop' as const, raw: 'stop' } : { unified: 'tool-calls' as const, raw: 'tool_calls' });
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const r = respond(options);
      return { content: r.content, finishReason: finishReason(r), usage: r.usage, warnings: [] };
    },
    async doStream(options) {
      const r = respond(options);
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        ...r.parts,
        { type: 'finish', usage: r.usage, finishReason: finishReason(r) },
      ];
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      };
    },
  };
}
