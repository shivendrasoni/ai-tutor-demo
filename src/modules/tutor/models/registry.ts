import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { llmModel } from '../config';
import { createMockModel } from './mock';

/** The model object the installed providers return (ai@7 / provider spec v4). */
export type TutorModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;
export type ModelTier = 'standard' | 'advanced';

const notConfigured = (msg: string) => new Error(`MODEL_NOT_CONFIGURED: ${msg}`);

export class ModelRegistry {
  private overrides = new Map<string, TutorModel>();

  /** `provider/model` (split on the first `/`). Throws MODEL_NOT_CONFIGURED on unknown provider or missing config. */
  resolve(spec: string): TutorModel {
    const o = this.overrides.get(spec) ?? this.overrides.get('*');
    if (o) return o;
    const i = spec.indexOf('/');
    if (i <= 0 || i === spec.length - 1) throw notConfigured(`invalid model spec "${spec}" (want provider/model)`);
    const provider = spec.slice(0, i);
    const id = spec.slice(i + 1);
    switch (provider) {
      case 'mock':
        return createMockModel(id) as TutorModel; // always available, no key
      case 'openai':
        return this.need('OPENAI_API_KEY', spec, () => createOpenAI()(id));
      case 'anthropic':
        return this.need('ANTHROPIC_API_KEY', spec, () => createAnthropic()(id));
      case 'google':
        return this.need('GOOGLE_GENERATIVE_AI_API_KEY', spec, () => createGoogleGenerativeAI()(id));
      case 'compat': {
        const baseURL = process.env.OPENAI_COMPAT_BASE_URL;
        if (!baseURL) throw notConfigured(`OPENAI_COMPAT_BASE_URL is not set (needed for "${spec}")`);
        return createOpenAICompatible({ name: 'compat', baseURL, apiKey: process.env.OPENAI_COMPAT_API_KEY })(id);
      }
      default:
        throw notConfigured(`unknown provider "${provider}" in "${spec}"`);
    }
  }

  /** Tests: `'*'` matches any spec without a more specific override. */
  override(spec: string | '*', model: TutorModel): void {
    this.overrides.set(spec, model);
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  specFor(skill: { models: { standard?: string; advanced?: string } }, tier: ModelTier): string {
    const spec = skill.models?.[tier] || llmModel(tier);
    if (!spec) throw notConfigured(`no ${tier} model for this skill and no LLM_${tier.toUpperCase()}_MODEL set`);
    return spec;
  }

  private need(envKey: string, spec: string, make: () => TutorModel): TutorModel {
    if (!process.env[envKey]) throw notConfigured(`${envKey} is not set (needed for "${spec}")`);
    return make();
  }
}
