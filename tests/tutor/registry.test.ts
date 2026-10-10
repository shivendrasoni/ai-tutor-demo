import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRegistry } from '@/modules/tutor/models/registry';

afterEach(() => vi.unstubAllEnvs());

describe('ModelRegistry', () => {
  it('resolves provider/model for each provider', () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('ANTHROPIC_API_KEY', 'k');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'k');
    vi.stubEnv('OPENAI_COMPAT_BASE_URL', 'http://localhost:11434/v1');
    const r = new ModelRegistry();
    expect(r.resolve('openai/gpt-4o-mini')).toMatchObject({ modelId: 'gpt-4o-mini' });
    expect(r.resolve('anthropic/claude-x').modelId).toBe('claude-x');
    expect(r.resolve('google/gemini-x').modelId).toBe('gemini-x');
    expect(r.resolve('compat/llama3').modelId).toBe('llama3');
  });

  it('keeps slashes after the first one in the model id', () => {
    vi.stubEnv('OPENAI_COMPAT_BASE_URL', 'http://localhost:11434/v1');
    expect(new ModelRegistry().resolve('compat/meta/llama3').modelId).toBe('meta/llama3');
  });

  it('rejects unknown provider, malformed spec and missing compat base url', () => {
    vi.stubEnv('OPENAI_COMPAT_BASE_URL', '');
    const r = new ModelRegistry();
    expect(() => r.resolve('foo/bar')).toThrow(/MODEL_NOT_CONFIGURED/);
    expect(() => r.resolve('nomodel')).toThrow(/MODEL_NOT_CONFIGURED/);
    expect(() => r.resolve('compat/llama3')).toThrow(/MODEL_NOT_CONFIGURED/);
  });

  it('override wins; * matches any; clearOverrides restores', () => {
    const a = new MockLanguageModelV4({ modelId: 'a' });
    const star = new MockLanguageModelV4({ modelId: 'star' });
    const r = new ModelRegistry();
    r.override('foo/bar', a);
    expect(r.resolve('foo/bar')).toBe(a);
    r.override('*', star);
    expect(r.resolve('foo/bar')).toBe(a);
    expect(r.resolve('whatever/else')).toBe(star);
    r.clearOverrides();
    expect(() => r.resolve('foo/bar')).toThrow(/MODEL_NOT_CONFIGURED/);
  });

  it('specFor prefers the skill entry, falls back to env per tier, throws if none', () => {
    vi.stubEnv('LLM_STANDARD_MODEL', 'openai/std');
    vi.stubEnv('LLM_ADVANCED_MODEL', 'openai/adv');
    const r = new ModelRegistry();
    expect(r.specFor({ models: { standard: 'anthropic/s' } }, 'standard')).toBe('anthropic/s');
    expect(r.specFor({ models: { standard: 'anthropic/s' } }, 'advanced')).toBe('openai/adv');
    expect(r.specFor({ models: {} }, 'standard')).toBe('openai/std');
    vi.stubEnv('LLM_ADVANCED_MODEL', '');
    expect(() => r.specFor({ models: {} }, 'advanced')).toThrow(/MODEL_NOT_CONFIGURED/);
  });
});
