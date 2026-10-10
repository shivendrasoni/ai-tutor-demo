import { aiMockMode } from '@/lib/ai-mode';
import { deciderMode, llmModel } from '../config';
import type { ModelRegistry } from '../models/registry';
import { FallbackDecider } from './fallback';
import { JevDecider } from './jev';
import { LlmDecider } from './llm';
import { MockDecider } from './mock';
import type { Decider } from './types';

export type Selected = { decider: Decider | null; provider: 'jev' | 'llm' | 'mock' | 'none' };

/** Applies DECIDER (or the key-based default); order: jev, llm (non-mock spec), MockDecider, none. A mode whose config is missing degrades to the next usable one. */
export function selectDecider(deps: { registry: ModelRegistry }): Selected {
  const mode = deciderMode();
  const spec = llmModel('standard');
  const llm = (): LlmDecider | null => {
    if (!spec || spec.startsWith('mock/')) return null; // never an LlmDecider over a mock model
    try {
      return new LlmDecider({ model: deps.registry.resolve(spec) });
    } catch {
      return null;
    }
  };
  if (mode === 'jev') {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (apiKey) {
      const jev = new JevDecider({ apiKey });
      const fallback = llm();
      return { decider: fallback ? new FallbackDecider(jev, fallback) : jev, provider: 'jev' };
    }
  }
  if (mode === 'jev' || mode === 'llm') {
    const l = llm();
    if (l) return { decider: l, provider: 'llm' };
  }
  // Mock: explicitly requested, or a mock model/mock mode with nothing real configured (DECIDER=none still wins).
  if (mode === 'mock' || (mode !== 'none' && (aiMockMode() || spec?.startsWith('mock/')))) {
    return { decider: new MockDecider(), provider: 'mock' };
  }
  return { decider: null, provider: 'none' };
}
