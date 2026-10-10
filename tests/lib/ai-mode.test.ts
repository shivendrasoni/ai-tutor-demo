import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiMockMode } from '@/lib/ai-mode';

afterEach(() => vi.restoreAllMocks());

describe('aiMockMode', () => {
  it('is on for AI_MOCK=1 regardless of NODE_ENV, VITEST or keys', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(aiMockMode({ AI_MOCK: '1', NODE_ENV: 'production', VITEST: 'true', OPENAI_API_KEY: 'k' })).toBe(true);
  });

  it('AI_MOCK=0 always disables it', () => {
    expect(aiMockMode({ AI_MOCK: '0', NODE_ENV: 'development' })).toBe(false);
  });

  it('defaults on only when NODE_ENV is development with no provider config (empty strings count as unset)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(aiMockMode({ NODE_ENV: 'development' })).toBe(true);
    expect(aiMockMode({ NODE_ENV: 'development', AI_MOCK: '', OPENAI_API_KEY: '', LLM_STANDARD_MODEL: '' })).toBe(true);
  });

  it('fails closed: unset NODE_ENV (e.g. a tsx worker in prod) never enables the default', () => {
    expect(aiMockMode({})).toBe(false);
    expect(aiMockMode({ AI_MOCK: '' })).toBe(false);
  });

  it('development with a real key is off', () => {
    expect(aiMockMode({ NODE_ENV: 'development', OPENAI_API_KEY: 'k' })).toBe(false);
  });

  it('never defaults on in production, test or vitest', () => {
    expect(aiMockMode({ NODE_ENV: 'production' })).toBe(false);
    expect(aiMockMode({ NODE_ENV: 'test' })).toBe(false);
    expect(aiMockMode({ NODE_ENV: 'development', VITEST: 'true' })).toBe(false);
  });

  it.each([
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'OPENAI_COMPAT_BASE_URL',
    'TYPESAFE_API_KEY',
    'LLM_STANDARD_MODEL',
    'LLM_ADVANCED_MODEL',
  ])('real-provider config %s turns the default off', (k) => {
    expect(aiMockMode({ NODE_ENV: 'development', [k]: 'x' })).toBe(false);
  });

  it('warns once per process the first time mock mode is used', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await import('@/lib/ai-mode');
    m.aiMockMode({ AI_MOCK: '1' });
    m.aiMockMode({ AI_MOCK: '1' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^AI mock mode:/);
  });
});
