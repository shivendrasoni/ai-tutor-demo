/** Real-provider settings; any of them (non-empty) turns the implicit mock default off. */
const REAL_PROVIDER_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_COMPAT_BASE_URL',
  'TYPESAFE_API_KEY',
  'LLM_STANDARD_MODEL',
  'LLM_ADVANCED_MODEL',
] as const;

let warned = false;

/**
 * True when the app should use deterministic mock AI providers.
 * - `AI_MOCK=1` forces it on; `AI_MOCK=0` forces it off.
 * - With `AI_MOCK` unset (or empty) it is on only when `NODE_ENV === 'development'` (`next dev`, `pnpm worker:dev`), outside
 *   vitest and with no real-provider config. Unset NODE_ENV (a tsx worker) never enables it, so a production deploy
 *   without keys never silently serves fake answers.
 */
export function aiMockMode(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.AI_MOCK;
  let on: boolean;
  if (flag === '1') on = true;
  else if (flag === '0') on = false;
  else
    on =
      env.NODE_ENV === 'development' && // fail closed: unset NODE_ENV (a tsx worker in prod) never enables it
      !env.VITEST &&
      !REAL_PROVIDER_KEYS.some((k) => env[k]);
  if (on && !warned) {
    warned = true;
    console.warn('AI mock mode: using deterministic mock AI providers (set AI_MOCK=0 or configure real keys to disable).');
  }
  return on;
}
