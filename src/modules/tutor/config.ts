import { aiMockMode } from '@/lib/ai-mode';

/** Tutor env config. Every function reads `process.env` on each call so tests can stub it. */
export type ModelPrice = { inPerM: number; outPerM: number };

export function dailyTokenLimit(): number {
  const n = Number(process.env.STUDENT_DAILY_TOKEN_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 200000;
}

export function modelPrices(): Record<string, ModelPrice> {
  const raw = process.env.MODEL_PRICES;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, ModelPrice>) : {};
  } catch {
    return {};
  }
}

export function llmModel(tier: 'standard' | 'advanced'): string | undefined {
  const v = tier === 'standard' ? process.env.LLM_STANDARD_MODEL : process.env.LLM_ADVANCED_MODEL;
  return v || (aiMockMode() ? `mock/${tier}` : undefined);
}

export type DeciderMode = 'jev' | 'llm' | 'mock' | 'none';

export function deciderMode(): DeciderMode {
  const d = process.env.DECIDER;
  if (d === 'jev' || d === 'llm' || d === 'mock' || d === 'none') return d;
  if (process.env.TYPESAFE_API_KEY) return 'jev';
  if (process.env.LLM_STANDARD_MODEL) return 'llm';
  if (aiMockMode()) return 'mock';
  return 'none';
}
