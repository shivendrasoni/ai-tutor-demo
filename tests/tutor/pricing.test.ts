import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyTokenLimit, deciderMode, modelPrices } from '@/modules/tutor/config';
import { computeCost } from '@/modules/tutor/models/pricing';

afterEach(() => vi.unstubAllEnvs());

describe('computeCost', () => {
  it('computes USD cost per million tokens; unknown model is null', () => {
    vi.stubEnv('MODEL_PRICES', JSON.stringify({ 'openai/m': { inPerM: 1, outPerM: 4 } }));
    expect(computeCost('openai/m', 500_000, 250_000)).toBeCloseTo(1.5);
    expect(computeCost('openai/other', 1, 1)).toBeNull();
  });
});

describe('config', () => {
  it('invalid MODEL_PRICES gives {}', () => {
    vi.stubEnv('MODEL_PRICES', '{nope');
    expect(modelPrices()).toEqual({});
    vi.stubEnv('MODEL_PRICES', '[1]');
    expect(modelPrices()).toEqual({});
  });
  it('dailyTokenLimit defaults to 200000 and reads env each call', () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '');
    expect(dailyTokenLimit()).toBe(200000);
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1000');
    expect(dailyTokenLimit()).toBe(1000);
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', 'abc');
    expect(dailyTokenLimit()).toBe(200000);
  });
  it('deciderMode: explicit, then jev by key, then llm by model, else none', () => {
    vi.stubEnv('DECIDER', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('LLM_STANDARD_MODEL', '');
    expect(deciderMode()).toBe('none');
    vi.stubEnv('LLM_STANDARD_MODEL', 'openai/x');
    expect(deciderMode()).toBe('llm');
    vi.stubEnv('TYPESAFE_API_KEY', 'k');
    expect(deciderMode()).toBe('jev');
    vi.stubEnv('DECIDER', 'none');
    expect(deciderMode()).toBe('none');
    vi.stubEnv('DECIDER', 'bogus');
    expect(deciderMode()).toBe('jev');
  });
});
