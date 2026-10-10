import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPlatform } from '@/db/client';
import { conversations, messages, skills, usageDaily } from '@/db/schema';
import type { ChunkHit } from '@/modules/content';
import { FakeDecider } from '@/modules/tutor/decider/fake';
import { confidenceFrom, type DeciderAnswer } from '@/modules/tutor/decider/types';
import { INTENTS } from '@/modules/tutor/routing';
import type { AgentRunner, RunEvent, RunInput } from '@/modules/tutor/runner/types';
import { seedSkills } from '@/modules/tutor/skills';
import { createConversation, getMessages, runTurn, type TurnEvent } from '@/modules/tutor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activate, resetTutorFakes, scriptedModel, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

let seed: Seed;
let student: Seed['a']['student'];
let convId: string;

const OFF_TOPIC = "I'm here to help with your studies. Ask me anything about your subjects!";
const UNSAFE = "I can't help with that. If something is worrying you, please talk to a parent, teacher, or another adult you trust.";
const BUSY = 'The tutor is busy right now. Please try again in a moment.';
const NOTICE = "I'll guide you step by step so you can work this out yourself.";

const uid = (n: string) => `00000000-0000-4000-8000-${n.replace(/\D/g, '0').padStart(12, '0').slice(-12)}`;
const hit = (id: string, o: Partial<ChunkHit> = {}): ChunkHit => ({
  chunkId: uid(id), contentItemId: 'ci', itemTitle: 'Bio 8', subjectId: 's', subjectName: 'Biology',
  chapterId: 'ch', chapterTitle: 'Ch 3', pageStart: 1, pageEnd: 2, text: `text ${id}`, similarity: 0.9, ...o,
});

const pick = (choice: string, options: string[], p: number): DeciderAnswer => {
  const probabilities: Record<string, number> = { [choice]: p };
  const other = options.find((o) => o !== choice)!;
  probabilities[other] = 1 - p;
  return { type: 'choice', choice, probabilities, confidence: confidenceFrom(probabilities) };
};
const intent = (c: string, p = 0.95) => pick(c, [...INTENTS], p);
const yesno = (p: number): DeciderAnswer => ({ type: 'yesno', p });
const defaultAnswers = (): Record<string, DeciderAnswer> => ({
  intent: intent('learn_concept'),
  out_of_syllabus: yesno(0.1),
  needs_review: yesno(0.1),
});

async function collect(it: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const usageTokens = async () =>
  (await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.studentId, student.userId)))).reduce(
    (a, r) => a + r.tokens, 0);
const newConv = async (skillKey = 'socratic') => (convId = (await createConversation(student, { skillKey })).id);
const lastAssistant = async () => (await getMessages(student, convId)).filter((m) => m.role === 'assistant').at(-1)!;

/** A runner that records its input and yields a canned answer. */
function spyRunner(text = 'ok'): AgentRunner & { inputs: RunInput[] } {
  const inputs: RunInput[] = [];
  return {
    inputs,
    async *run(input: RunInput): AsyncGenerator<RunEvent> {
      inputs.push(input);
      yield { type: 'delta', text };
      yield { type: 'finish', usage: { tokensIn: 10, tokensOut: 5 } };
    },
  };
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  student = seed.a.student;
  await seedTutorSkills();
  await activate(student);
});
beforeEach(async () => {
  await withPlatform(async (tx) => {
    await tx.delete(usageDaily);
    await tx.delete(messages);
    await tx.delete(conversations);
    await tx.update(skills).set({ models: {} });
  });
  await seedSkills();
});
afterEach(() => resetTutorFakes());

describe('runTurn', () => {
  it('happy path: event order, citations, logging, usage', async () => {
    const model = scriptedModel([
      { toolCall: { name: 'search_curriculum', input: { query: 'photosynthesis' } } },
      { text: 'Plants make food [1]. Also [7].', usage: { in: 200, out: 40 } },
    ]);
    useTutorFakes({ model, hits: [hit('1', { pageStart: 12, pageEnd: 13 })], decider: new FakeDecider(defaultAnswers()) });
    await newConv();
    const events = await collect(runTurn(student, convId, 'What is photosynthesis?'));
    const n = events.filter((e) => e.type === 'delta').length;
    expect(n).toBeGreaterThan(1);
    expect(events.map((e) => e.type)).toEqual(['meta', ...Array(n).fill('delta'), 'citations', 'done']);
    const cit = events.find((e) => e.type === 'citations') as Extract<TurnEvent, { type: 'citations' }>;
    expect(cit.data.citations).toEqual([
      { n: 1, chunkId: uid('1'), itemTitle: 'Bio 8', chapterTitle: 'Ch 3', pageStart: 12, pageEnd: 13 },
    ]);
    const [user, assistant] = await getMessages(student, convId);
    expect(user).toMatchObject({ role: 'user', content: 'What is photosynthesis?' });
    expect(assistant).toMatchObject({
      role: 'assistant', retrievedChunkIds: [uid('1')], tokensIn: 210, tokensOut: 45, model: 'openai/test-standard',
      modelTier: 'standard', cost: expect.anything(),
    });
    expect((events[0] as { data: { messageId: string } }).data.messageId).toBe(assistant.id);
    expect(assistant.decisions).toMatchObject({
      fixedReply: null, filterFallback: false, deciderProvider: 'llm', deciderError: false, deciderFellBack: false, aborted: false,
    });
    expect(await usageTokens()).toBe(assistant.tokensIn + assistant.tokensOut);
    expect(events.at(-1)).toEqual({ type: 'done', data: { tokensIn: 210, tokensOut: 45 } });
  });

  it('sets title from the first 60 chars of the first message only', async () => {
    useTutorFakes({ runner: spyRunner() });
    await newConv();
    const long = 'x'.repeat(100);
    await collect(runTurn(student, convId, long));
    await collect(runTurn(student, convId, 'second'));
    const [c] = await withPlatform((tx) => tx.select().from(conversations).where(eq(conversations.id, convId)));
    expect(c.title).toBe('x'.repeat(60));
  });

  it('history: only the last 20 messages reach the runner (seed 30)', async () => {
    const runner = spyRunner();
    useTutorFakes({ runner });
    await newConv();
    await withPlatform((tx) =>
      tx.insert(messages).values(
        Array.from({ length: 30 }, (_, i) => ({
          schoolId: seed.a.schoolId, conversationId: convId, role: i % 2 ? 'assistant' : 'user',
          content: `m${i}`, createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)),
        })),
      ),
    );
    await collect(runTurn(student, convId, 'new one'));
    const h = runner.inputs[0].history;
    expect(h).toHaveLength(20);
    expect(h[0].content).toBe('m10');
    expect(h.at(-1)!.content).toBe('m29');
    expect(runner.inputs[0].userText).toBe('new one');
    expect(runner.inputs[0].maxSteps).toBe(5);
  });

  it('decider state is last 4 messages plus new, role: content lines', async () => {
    const decider = new FakeDecider({});
    useTutorFakes({ runner: spyRunner(), decider });
    await newConv();
    await withPlatform((tx) =>
      tx.insert(messages).values(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((c, i) => ({
          schoolId: seed.a.schoolId, conversationId: convId, role: i % 2 ? 'assistant' : 'user',
          content: c, createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)),
        })),
      ),
    );
    await collect(runTurn(student, convId, 'question'));
    expect(decider.calls[0].state).toBe('user: c\nassistant: d\nuser: e\nassistant: f\nuser: question');
  });

  it('routed filters reach searchChunks; chapter call runs only when subject confidence >= 0.4', async () => {
    const subj = seed.a.subjectId;
    const chap = '11111111-1111-4111-8111-111111111111';
    const subjects = [{ id: subj, name: 'Mathematics' }];
    const chapters = { [subj]: [{ id: chap, title: 'Fractions' }] };
    const model = scriptedModel([
      { toolCall: { name: 'search_curriculum', input: { query: 'q' } } }, { text: 'done' },
    ]);
    const answers = (conf: number) => (_s: string, q: Record<string, unknown>): Record<string, DeciderAnswer> =>
      'chapter' in q
        ? { chapter: pick(chap, [chap, 'none'], 0.9) }
        : { ...defaultAnswers(), subject: pick(subj, [subj, 'other'], conf) };
    const high = new FakeDecider(answers(0.95));
    const f = useTutorFakes({ model, decider: high, hits: [hit('1')], subjects, chapters });
    await newConv();
    await collect(runTurn(student, convId, 'q'));
    expect(high.calls).toHaveLength(2);
    expect(f.search.mock.calls[0][2]).toEqual({ subjectIds: [subj], chapterIds: [chap] });

    resetTutorFakes();
    const low = new FakeDecider(answers(0.55)); // confidence ~0.1 < 0.4
    const f2 = useTutorFakes({ model: scriptedModel([{ toolCall: { name: 'search_curriculum', input: { query: 'q' } } }, { text: 'd' }]), decider: low, hits: [hit('1')], subjects, chapters });
    await newConv();
    await collect(runTurn(student, convId, 'q'));
    expect(low.calls).toHaveLength(1);
    expect(f2.search.mock.calls[0][2]).toEqual({});
  });

  it('filter fallback: filtered 0 hits then unfiltered; decisions.filterFallback true', async () => {
    const subj = seed.a.subjectId;
    const decider = new FakeDecider(() => ({ ...defaultAnswers(), subject: pick(subj, [subj, 'other'], 0.95) }));
    const f = useTutorFakes({
      model: scriptedModel([{ toolCall: { name: 'search_curriculum', input: { query: 'q' } } }, { text: 'a [1]' }]),
      decider, subjects: [{ id: subj, name: 'Mathematics' }],
      hits: (_s, _q, opts) => ((opts as { subjectIds?: string[] }).subjectIds ? [] : [hit('9')]),
    });
    await newConv();
    await collect(runTurn(student, convId, 'q'));
    expect(f.search).toHaveBeenCalledTimes(2);
    expect((await lastAssistant()).decisions).toMatchObject({ filterFallback: true });
  });

  it('fixed reply off_topic: no model call, model null, exact copy, meta/delta/citations/done', async () => {
    const model = scriptedModel([{ text: 'never' }]);
    useTutorFakes({ model, decider: new FakeDecider({ ...defaultAnswers(), intent: intent('off_topic', 0.99) }) });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'who won the match'));
    expect(ev.map((e) => e.type)).toEqual(['meta', 'delta', 'citations', 'done']);
    expect((ev[1] as { data: { text: string } }).data.text).toBe(OFF_TOPIC);
    expect(ev[3]).toEqual({ type: 'done', data: { tokensIn: 0, tokensOut: 0 } });
    expect(model.calls).toBe(0);
    const a = await lastAssistant();
    expect(a).toMatchObject({ model: null, content: OFF_TOPIC, flagged: false, tokensIn: 0 });
    expect(a.decisions).toMatchObject({ fixedReply: 'off_topic' });
  });

  it('fixed reply unsafe: exact copy, flagged with reason unsafe, no model call', async () => {
    const model = scriptedModel([{ text: 'never' }]);
    useTutorFakes({ model, decider: new FakeDecider({ ...defaultAnswers(), intent: intent('unsafe', 0.9) }) });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'bad'));
    expect((ev[1] as { data: { text: string } }).data.text).toBe(UNSAFE);
    expect(model.calls).toBe(0);
    expect(await lastAssistant()).toMatchObject({ content: UNSAFE, flagged: true, flagReason: 'unsafe', model: null });
  });

  it('needs_review flags the assistant message with decider_review but still answers', async () => {
    useTutorFakes({ runner: spyRunner('hi'), decider: new FakeDecider({ ...defaultAnswers(), needs_review: yesno(0.9) }) });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'i am sad'));
    expect(ev.at(-1)!.type).toBe('done');
    expect(await lastAssistant()).toMatchObject({ flagged: true, flagReason: 'decider_review', content: 'hi' });
  });

  it('wants_final_answer on explain: meta.notice is the socratic copy and instructions are the socratic skill', async () => {
    const runner = spyRunner();
    useTutorFakes({ runner, decider: new FakeDecider({ ...defaultAnswers(), intent: intent('wants_final_answer') }) });
    await newConv('explain');
    const ev = await collect(runTurn(student, convId, 'just tell me'));
    expect(ev[0]).toMatchObject({ type: 'meta', data: { skill: 'socratic', notice: NOTICE } });
    expect(runner.inputs[0].instructions).toContain('You are a Socratic tutor');
    expect(runner.inputs[0].instructions).toContain('class 8 student at School A');
  });

  it('out_of_syllabus appends the line to the instructions passed to the runner', async () => {
    const runner = spyRunner();
    useTutorFakes({ runner, decider: new FakeDecider({ ...defaultAnswers(), out_of_syllabus: yesno(0.9) }) });
    await newConv();
    await collect(runTurn(student, convId, 'q'));
    expect(runner.inputs[0].instructions).toContain('likely goes beyond the class 8 syllabus');
  });

  it('advanced tier picks the skill advanced model', async () => {
    await withPlatform((tx) =>
      tx.update(skills).set({ models: { standard: 'openai/s1', advanced: 'openai/a1' } }).where(eq(skills.key, 'socratic')),
    );
    useTutorFakes({
      runner: spyRunner(),
      decider: new FakeDecider({
        ...defaultAnswers(),
        difficulty: { type: 'score', score: 2, probabilities: { recall: 0.1, multi_step: 0.9 }, confidence: 0.8 },
      }),
    });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'hard'));
    expect(ev[0]).toMatchObject({ data: { modelTier: 'advanced' } });
    expect(await lastAssistant()).toMatchObject({ model: 'openai/a1', modelTier: 'advanced' });
  });

  it('decider throws -> defaults, deciderError true, still answers', async () => {
    useTutorFakes({ runner: spyRunner(), decider: new FakeDecider(() => new Error('boom')) });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(ev.at(-1)!.type).toBe('done');
    expect((await lastAssistant()).decisions).toMatchObject({ deciderError: true, answers: {} });
  });

  it('deciderFellBack comes from the per-call DeciderRun', async () => {
    const decider = {
      async decide(_s: string, _q: unknown, meta?: { fellBack: boolean }) {
        if (meta) meta.fellBack = true;
        return {};
      },
    };
    useTutorFakes({ runner: spyRunner() });
    const { configureTutor } = await import('@/modules/tutor');
    configureTutor({ decider: decider as never, deciderProvider: 'jev' });
    await newConv();
    await collect(runTurn(student, convId, 'q'));
    expect((await lastAssistant()).decisions).toMatchObject({ deciderFellBack: true, deciderProvider: 'jev' });
  });

  it('budget exhausted: single error BUDGET_EXCEEDED event, zero model and decider calls, no messages stored', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '100');
    await withPlatform((tx) =>
      tx.insert(usageDaily).values({ schoolId: seed.a.schoolId, studentId: student.userId, date: new Date().toISOString().slice(0, 10), tokens: 100 }),
    );
    const decider = new FakeDecider({});
    const f = useTutorFakes({ decider });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'error', data: { code: 'BUDGET_EXCEEDED' } });
    expect(f.model.calls).toBe(0);
    expect(decider.calls).toHaveLength(0);
    expect(await getMessages(student, convId)).toEqual([]);
  });

  it('REVIEW FOCUS 5: a turn that crosses the budget completes and is recorded; the next turn is BUDGET_EXCEEDED', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '100');
    const model = scriptedModel([{ text: 'answer', usage: { in: 200, out: 40 } }]);
    useTutorFakes({ model });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q1'));
    expect(ev.at(-1)!.type).toBe('done');
    expect(await usageTokens()).toBe(240);
    const calls = model.calls;
    expect((await collect(runTurn(student, convId, 'q2')))[0]).toMatchObject({ type: 'error', data: { code: 'BUDGET_EXCEEDED' } });
    expect(model.calls).toBe(calls);
  });

  it('provider error: retried once then TUTOR_BUSY; user message kept; no assistant row; exact message', async () => {
    const model = scriptedModel([{ error: new Error('x') }, { error: new Error('y') }]);
    useTutorFakes({ model });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(ev.at(-1)).toEqual({ type: 'error', data: { code: 'TUTOR_BUSY', message: BUSY } });
    expect(model.calls).toBe(2);
    expect((await getMessages(student, convId)).map((m) => m.role)).toEqual(['user']);
  });

  it('MODEL_NOT_CONFIGURED is not retried and becomes TUTOR_BUSY', async () => {
    const f = useTutorFakes({});
    vi.stubEnv('LLM_STANDARD_MODEL', '');
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(ev.at(-1)).toEqual({ type: 'error', data: { code: 'TUTOR_BUSY', message: BUSY } });
    expect(f.model.calls).toBe(0);
    expect((await getMessages(student, convId)).map((m) => m.role)).toEqual(['user']);
  });

  it('one transient failure then success: answer delivered, a single assistant message', async () => {
    const model = scriptedModel([{ error: new Error('x') }, { text: 'fine' }]);
    useTutorFakes({ model });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(ev.at(-1)!.type).toBe('done');
    expect(model.calls).toBe(2);
    const msgs = await getMessages(student, convId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toBe('fine');
  });

  it('failure after deltas were streamed is not retried; partial text saved; TUTOR_BUSY emitted', async () => {
    let calls = 0;
    const runner: AgentRunner = {
      async *run() {
        calls++;
        yield { type: 'delta', text: 'partial' };
        throw new Error('mid-stream');
      },
    };
    useTutorFakes({ runner });
    await newConv();
    const ev = await collect(runTurn(student, convId, 'q'));
    expect(calls).toBe(1);
    expect(ev.map((e) => e.type)).toEqual(['meta', 'delta', 'error']);
    expect(ev.at(-1)).toMatchObject({ data: { code: 'TUTOR_BUSY' } });
    expect(await lastAssistant()).toMatchObject({ content: 'partial' });
    expect(await usageTokens()).toBeGreaterThan(0);
  });

  it('REVIEW FOCUS 3: client abort mid-stream still saves the partial message and records usage', async () => {
    useTutorFakes({ model: scriptedModel([{ text: 'A long answer that streams in several parts.' }]) });
    await newConv();
    const it = runTurn(student, convId, 'q');
    await it.next(); // meta
    await it.next(); // first delta
    await it.return(undefined); // client disconnects
    const a = (await getMessages(student, convId)).find((m) => m.role === 'assistant')!;
    expect(a.content.length).toBeGreaterThan(0);
    expect(a.decisions).toMatchObject({ aborted: true });
    expect(await usageTokens()).toBeGreaterThan(0);
  });

  it('abort via AbortSignal ends the stream without done and persists', async () => {
    useTutorFakes({ model: scriptedModel([{ text: 'A long answer that streams in several parts.' }]) });
    await newConv();
    const ac = new AbortController();
    const out: TurnEvent[] = [];
    for await (const e of runTurn(student, convId, 'q', { signal: ac.signal })) {
      out.push(e);
      if (e.type === 'delta') ac.abort();
    }
    expect(out.some((e) => e.type === 'done')).toBe(false);
    expect((await lastAssistant()).decisions).toMatchObject({ aborted: true });
    expect(await usageTokens()).toBeGreaterThan(0);
  });

  it('REVIEW FOCUS 4: two concurrent turns in one conversation both complete', async () => {
    useTutorFakes({ model: scriptedModel([{ text: 'reply', usage: { in: 50, out: 10 } }]) });
    await newConv();
    const [e1, e2] = await Promise.all([
      collect(runTurn(student, convId, 'first question')),
      collect(runTurn(student, convId, 'second question')),
    ]);
    expect(e1.at(-1)!.type).toBe('done');
    expect(e2.at(-1)!.type).toBe('done');
    const msgs = await getMessages(student, convId);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(2);
    expect(await usageTokens()).toBe(120);
    const [c] = await withPlatform((tx) => tx.select().from(conversations).where(eq(conversations.id, convId)));
    expect(['first question', 'second question']).toContain(c.title);
  });

  it("another student's conversation: first next() rejects NOT_FOUND", async () => {
    useTutorFakes({});
    await newConv();
    await activate(seed.b.student);
    await expect(runTurn(seed.b.student, convId, 'hi').next()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('non-active student: FORBIDDEN; over-long and empty text: VALIDATION', async () => {
    useTutorFakes({});
    await newConv();
    await expect(runTurn(student, convId, 'x'.repeat(4001)).next()).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(runTurn(student, convId, '   ').next()).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(runTurn(seed.a.teacher, convId, 'hi').next()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getMessages(student, convId)).toEqual([]);
  });
});
