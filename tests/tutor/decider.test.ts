import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDecider } from '@/modules/tutor/decider/fake';
import { FallbackDecider } from '@/modules/tutor/decider/fallback';
import { JevDecider } from '@/modules/tutor/decider/jev';
import { LlmDecider } from '@/modules/tutor/decider/llm';
import { selectDecider } from '@/modules/tutor/decider/select';
import { confidenceFrom, sanitizeAnswers, type DeciderQuestion } from '@/modules/tutor/decider/types';
import { ModelRegistry } from '@/modules/tutor/models/registry';

const questions: Record<string, DeciderQuestion> = {
  intent: { type: 'choice', instructions: 'What does the student want?', options: { learn_concept: 'learn a concept', off_topic: 'unrelated' } },
  subject: { type: 'choice', instructions: 'Which subject?', options: { math: 'Maths', science: 'Science' } },
  difficulty: { type: 'score', instructions: 'How hard?', levels: ['recall', 'apply', 'multi_step'] },
  out_of_syllabus: { type: 'yesno', statement: 'The question is beyond the syllabus' },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('JevDecider', () => {
  it('maps requests and parses responses (mocked fetch)', async () => {
    const f = vi.fn(
      async (_u: unknown, _init: any) =>
        new Response(
          JSON.stringify({
            answers: {
              intent: { choice: 'learn_concept', probabilities: { learn_concept: 0.9, off_topic: 0.1 }, confidence: 0.8 },
              difficulty: { score: 2, probabilities: { recall: 0.1, apply: 0.2, multi_step: 0.7 }, confidence: 0.55 },
              out_of_syllabus: { answer: 'noul', probabilities: { noul: 0.7 } },
            },
          }),
        ),
    );
    const d = new JevDecider({ apiKey: 'k', fetch: f as any });
    const out = await d.decide('user: hi', questions);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('jev-latest');
    expect(body.state).toBe('user: hi');
    expect(body.questions.out_of_syllabus).toEqual({
      type: 'noul',
      instructions: (questions.out_of_syllabus as { statement: string }).statement,
    });
    expect(body.questions.intent.criteria).toEqual((questions.intent as { options: unknown }).options);
    expect(body.questions.difficulty).toEqual({ type: 'score', criteria: ['recall', 'apply', 'multi_step'] });
    expect(out.out_of_syllabus).toEqual({ type: 'yesno', p: 0.7 });
    expect(out.difficulty).toMatchObject({ type: 'score', score: 2 });
    expect(out.intent).toMatchObject({ type: 'choice', choice: 'learn_concept', confidence: 0.8 });
    expect(out.subject).toBeUndefined();
  });

  it('times out after 500ms and rejects', async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_u: unknown, init: any) =>
        new Promise<Response>((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    const p = new JevDecider({ apiKey: 'k', fetch: f as any }).decide('s', questions);
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(499);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
  });

  it('rejects on a 500 response and on garbage JSON', async () => {
    const bad = new JevDecider({ apiKey: 'k', fetch: (async () => new Response('x', { status: 500 })) as any });
    await expect(bad.decide('s', questions)).rejects.toThrow();
    const garbage = new JevDecider({ apiKey: 'k', fetch: (async () => new Response('not json')) as any });
    await expect(garbage.decide('s', questions)).rejects.toThrow();
    const noAnswers = new JevDecider({ apiKey: 'k', fetch: (async () => new Response('{"x":1}')) as any });
    await expect(noAnswers.decide('s', questions)).rejects.toThrow();
  });

  it('drops answers with an option id that is not in the list', async () => {
    const f = async () =>
      new Response(
        JSON.stringify({ answers: { intent: { choice: 'made_up', probabilities: { made_up: 1 }, confidence: 1 } } }),
      );
    expect(await new JevDecider({ apiKey: 'k', fetch: f as any }).decide('s', questions)).toEqual({});
  });
});

describe('confidenceFrom', () => {
  it('is (pmax-1/n)/(1-1/n)', () => {
    expect(confidenceFrom({ a: 0.5, b: 0.5 })).toBeCloseTo(0);
    expect(confidenceFrom({ a: 1, b: 0 })).toBeCloseTo(1);
    expect(confidenceFrom({ a: 0.7, b: 0.2, c: 0.1 })).toBeCloseTo((0.7 - 1 / 3) / (1 - 1 / 3));
    expect(confidenceFrom({ a: 0.3 })).toBe(1);
  });
});

describe('LlmDecider', () => {
  it('uses structured output on the model and computes choice and confidence from probabilities', async () => {
    const payload = {
      intent: { probabilities: { learn_concept: 0.8, off_topic: 0.2 } },
      subject: { probabilities: { math: 0.5, science: 0.5 } },
      difficulty: { probabilities: { recall: 0.1, apply: 0.2, multi_step: 0.7 } },
      out_of_syllabus: { p: 0.3 },
    };
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const out = await new LlmDecider({ model }).decide('user: hi', questions);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(out.intent).toMatchObject({ type: 'choice', choice: 'learn_concept' });
    expect((out.intent as { confidence: number }).confidence).toBeCloseTo(confidenceFrom({ a: 0.8, b: 0.2 }));
    expect(out.difficulty).toMatchObject({ type: 'score', score: 2 });
    expect(out.out_of_syllabus).toEqual({ type: 'yesno', p: 0.3 });
  });
});

describe('sanitizeAnswers', () => {
  it('drops unknown option ids, NaN, out-of-range, wrong type', () => {
    const out = sanitizeAnswers(questions, {
      intent: { type: 'choice', choice: 'made_up', probabilities: { made_up: 1 }, confidence: 1 },
      subject: { type: 'choice', choice: 'math', probabilities: { math: NaN }, confidence: 0.9 },
      difficulty: { type: 'score', score: 7, probabilities: {}, confidence: 0.5 },
      out_of_syllabus: { type: 'yesno', p: 1.5 },
    });
    expect(out).toEqual({});
  });

  it('drops wrong-type answers, bad confidence, non-integer score and unknown question ids; keeps valid ones', () => {
    const out = sanitizeAnswers(questions, {
      intent: { type: 'yesno', p: 0.5 },
      subject: { type: 'choice', choice: 'math', probabilities: { math: 0.9 }, confidence: 1.2 },
      difficulty: { type: 'score', score: 1.5, probabilities: {}, confidence: 0.5 },
      out_of_syllabus: { type: 'yesno', p: 0.4 },
      bogus: { type: 'yesno', p: 0.4 },
    });
    expect(out).toEqual({ out_of_syllabus: { type: 'yesno', p: 0.4 } });
    expect(sanitizeAnswers(questions, null as any)).toEqual({});
  });
});

describe('FallbackDecider', () => {
  const ok = (p: number) => new FakeDecider({ out_of_syllabus: { type: 'yesno', p } });
  const boom = () => new FakeDecider(() => new Error('boom'));

  it('primary ok: no fallback', async () => {
    const d = new FallbackDecider(ok(0.1), ok(0.9));
    expect((await d.decide('s', questions)).out_of_syllabus).toEqual({ type: 'yesno', p: 0.1 });
    expect(d.lastRun).toEqual({ fellBack: false, primaryError: false, secondaryError: false });
  });
  it('primary throws: secondary used', async () => {
    const d = new FallbackDecider(boom(), ok(0.9));
    expect((await d.decide('s', questions)).out_of_syllabus).toEqual({ type: 'yesno', p: 0.9 });
    expect(d.lastRun).toEqual({ fellBack: true, primaryError: true, secondaryError: false });
  });
  it('both throw: rejects', async () => {
    const d = new FallbackDecider(boom(), boom());
    await expect(d.decide('s', questions)).rejects.toThrow();
    expect(d.lastRun).toEqual({ fellBack: true, primaryError: true, secondaryError: true });
  });
});

describe('FakeDecider', () => {
  it('records calls and sanitizes the scripted output', async () => {
    const d = new FakeDecider({ out_of_syllabus: { type: 'yesno', p: 3 } });
    expect(await d.decide('s', questions)).toEqual({});
    expect(d.calls).toEqual([{ state: 's', questions }]);
  });
});

describe('selectDecider', () => {
  const registry = () => {
    const r = new ModelRegistry();
    r.override('*', new MockLanguageModelV4());
    return r;
  };
  const env = (e: Record<string, string>) => {
    for (const k of ['DECIDER', 'TYPESAFE_API_KEY', 'LLM_STANDARD_MODEL']) vi.stubEnv(k, e[k] ?? '');
  };

  it('jev with an LLM configured chains Jev then LLM', () => {
    env({ TYPESAFE_API_KEY: 'k', LLM_STANDARD_MODEL: 'openai/x' });
    const s = selectDecider({ registry: registry() });
    expect(s.provider).toBe('jev');
    expect(s.decider).toBeInstanceOf(FallbackDecider);
  });
  it('jev without an LLM is Jev alone', () => {
    env({ TYPESAFE_API_KEY: 'k' });
    const s = selectDecider({ registry: registry() });
    expect(s.provider).toBe('jev');
    expect(s.decider).toBeInstanceOf(JevDecider);
  });
  it('llm when only the LLM model is set, or DECIDER=llm', () => {
    env({ LLM_STANDARD_MODEL: 'openai/x' });
    expect(selectDecider({ registry: registry() })).toMatchObject({ provider: 'llm' });
    env({ DECIDER: 'llm', TYPESAFE_API_KEY: 'k', LLM_STANDARD_MODEL: 'openai/x' });
    const s = selectDecider({ registry: registry() });
    expect(s.provider).toBe('llm');
    expect(s.decider).toBeInstanceOf(LlmDecider);
  });
  it('none by default and when forced', () => {
    env({});
    expect(selectDecider({ registry: registry() })).toEqual({ decider: null, provider: 'none' });
    env({ DECIDER: 'none', TYPESAFE_API_KEY: 'k', LLM_STANDARD_MODEL: 'openai/x' });
    expect(selectDecider({ registry: registry() })).toEqual({ decider: null, provider: 'none' });
  });
  it('unusable modes degrade to none (llm without model; jev without key)', () => {
    env({ DECIDER: 'llm' });
    expect(selectDecider({ registry: registry() }).provider).toBe('none');
    env({ DECIDER: 'jev' });
    expect(selectDecider({ registry: registry() }).provider).toBe('none');
  });
});
