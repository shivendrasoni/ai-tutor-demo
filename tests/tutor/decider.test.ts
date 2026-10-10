import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDecider } from '@/modules/tutor/decider/fake';
import { FallbackDecider } from '@/modules/tutor/decider/fallback';
import { JevDecider } from '@/modules/tutor/decider/jev';
import { LlmDecider } from '@/modules/tutor/decider/llm';
import { MockDecider } from '@/modules/tutor/decider/mock';
import { selectDecider } from '@/modules/tutor/decider/select';
import { confidenceFrom, sanitizeAnswers, type Decider, type DeciderQuestion, type DeciderRun } from '@/modules/tutor/decider/types';
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
  const fresh = (): DeciderRun => ({ fellBack: true, primaryError: true, secondaryError: true });

  it('primary ok: no fallback', async () => {
    const d = new FallbackDecider(ok(0.1), ok(0.9));
    const m = fresh();
    expect((await d.decide('s', questions, m)).out_of_syllabus).toEqual({ type: 'yesno', p: 0.1 });
    expect(m).toEqual({ fellBack: false, primaryError: false, secondaryError: false });
  });
  it('primary throws: secondary used', async () => {
    const d = new FallbackDecider(boom(), ok(0.9));
    const m = fresh();
    expect((await d.decide('s', questions, m)).out_of_syllabus).toEqual({ type: 'yesno', p: 0.9 });
    expect(m).toEqual({ fellBack: true, primaryError: true, secondaryError: false });
  });
  it('both throw: rejects and meta is filled', async () => {
    const d = new FallbackDecider(boom(), boom());
    const m = fresh();
    await expect(d.decide('s', questions, m)).rejects.toThrow();
    expect(m).toEqual({ fellBack: true, primaryError: true, secondaryError: true });
  });
  it('works without meta', async () => {
    expect(await new FallbackDecider(boom(), ok(0.5)).decide('s', questions)).toEqual({
      out_of_syllabus: { type: 'yesno', p: 0.5 },
    });
  });
  it('concurrent calls on one instance keep separate meta', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const primary: Decider = {
      async decide(state) {
        if (state === 'fail') {
          await gate;
          throw new Error('boom');
        }
        return { out_of_syllabus: { type: 'yesno', p: 0.2 } };
      },
    };
    const d = new FallbackDecider(primary, ok(0.9));
    const mFail = fresh();
    const mOk = fresh();
    const pFail = d.decide('fail', questions, mFail);
    const pOk = d.decide('good', questions, mOk);
    await pOk;
    release();
    await pFail;
    expect(mOk).toEqual({ fellBack: false, primaryError: false, secondaryError: false });
    expect(mFail).toEqual({ fellBack: true, primaryError: true, secondaryError: false });
  });
});

describe('sanitizeAnswers probability keys', () => {
  const base = { type: 'choice', choice: 'math', confidence: 0.5 };
  it('drops unknown keys, empty maps, and maps missing the chosen key', () => {
    expect(sanitizeAnswers(questions, { subject: { ...base, probabilities: { math: 0.5, art: 0.5 } } })).toEqual({});
    expect(sanitizeAnswers(questions, { subject: { ...base, probabilities: {} } })).toEqual({});
    expect(sanitizeAnswers(questions, { subject: { ...base, probabilities: { science: 1 } } })).toEqual({});
    expect(
      sanitizeAnswers(questions, {
        difficulty: { type: 'score', score: 1, confidence: 0.5, probabilities: { recall: 1 } },
      }),
    ).toEqual({});
    expect(
      sanitizeAnswers(questions, {
        difficulty: { type: 'score', score: 1, confidence: 0.5, probabilities: { apply: 0.6, bogus: 0.4 } },
      }),
    ).toEqual({});
  });
  it('keeps a well-formed answer', () => {
    const a = { ...base, probabilities: { math: 0.8, science: 0.2 } };
    expect(sanitizeAnswers(questions, { subject: a })).toEqual({ subject: a });
  });
  it('Jev answer without probabilities is dropped (no fabricated confidence)', async () => {
    const f = async () => new Response(JSON.stringify({ answers: { subject: { choice: 'math' } } }));
    expect(await new JevDecider({ apiKey: 'k', fetch: f as any }).decide('s', questions)).toEqual({});
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
    for (const k of ['DECIDER', 'TYPESAFE_API_KEY', 'LLM_STANDARD_MODEL', 'AI_MOCK']) vi.stubEnv(k, e[k] ?? '');
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
  it('mock mode (AI_MOCK=1) selects MockDecider when no real decider is configured', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    env({ AI_MOCK: '1' });
    const s = selectDecider({ registry: registry() });
    expect(s.provider).toBe('mock');
    expect(s.decider).toBeInstanceOf(MockDecider);
  });
  it('DECIDER=mock selects MockDecider outside mock mode; DECIDER=none still wins in mock mode', () => {
    env({ DECIDER: 'mock' });
    expect(selectDecider({ registry: registry() }).decider).toBeInstanceOf(MockDecider);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    env({ DECIDER: 'none', AI_MOCK: '1' });
    expect(selectDecider({ registry: registry() })).toEqual({ decider: null, provider: 'none' });
  });
  it('real config beats mock mode: jev, then a non-mock llm', () => {
    env({ AI_MOCK: '1', TYPESAFE_API_KEY: 'k' });
    expect(selectDecider({ registry: registry() }).provider).toBe('jev');
    env({ AI_MOCK: '1', LLM_STANDARD_MODEL: 'openai/x' });
    expect(selectDecider({ registry: registry() }).provider).toBe('llm');
  });
  it('never builds an LlmDecider over a mock/* model', () => {
    env({ LLM_STANDARD_MODEL: 'mock/standard' });
    const s = selectDecider({ registry: registry() });
    expect(s.provider).toBe('mock');
    expect(s.decider).toBeInstanceOf(MockDecider);
    env({ TYPESAFE_API_KEY: 'k', LLM_STANDARD_MODEL: 'mock/standard' });
    expect(selectDecider({ registry: registry() }).decider).toBeInstanceOf(JevDecider);
  });
});
