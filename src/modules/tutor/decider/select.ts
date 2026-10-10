import { deciderMode, llmModel } from '../config';
import type { ModelRegistry } from '../models/registry';
import { FallbackDecider } from './fallback';
import { JevDecider } from './jev';
import { LlmDecider } from './llm';
import type { Decider } from './types';

export type Selected = { decider: Decider | null; provider: 'jev' | 'llm' | 'none' };

/** Applies DECIDER (or the key-based default). A mode whose config is missing degrades to the next usable one. */
export function selectDecider(deps: { registry: ModelRegistry }): Selected {
  const mode = deciderMode();
  const spec = llmModel('standard');
  const llm = (): LlmDecider | null => {
    if (!spec) return null;
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
  if (mode !== 'none') {
    const l = llm();
    if (l) return { decider: l, provider: 'llm' };
  }
  return { decider: null, provider: 'none' };
}
