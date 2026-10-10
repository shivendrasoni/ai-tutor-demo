export type DeciderQuestion =
  | { type: 'choice'; instructions: string; options: Record<string, string> }
  | { type: 'score'; instructions: string; levels: string[] }
  | { type: 'yesno'; statement: string };

export type DeciderAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'yesno'; p: number };

/** Per-call fallback report, filled by FallbackDecider into the caller-owned `meta` object. */
export type DeciderRun = { fellBack: boolean; primaryError: boolean; secondaryError: boolean };

export interface Decider {
  decide(
    state: string,
    questions: Record<string, DeciderQuestion>,
    meta?: DeciderRun,
  ): Promise<Record<string, DeciderAnswer>>;
}

/** (pmax - 1/n) / (1 - 1/n); n = number of keys; n <= 1 gives 1. */
export function confidenceFrom(probabilities: Record<string, number>): number {
  const vals = Object.values(probabilities);
  const n = vals.length;
  if (n <= 1) return 1;
  const pmax = Math.max(...vals);
  return (pmax - 1 / n) / (1 - 1 / n);
}

const unit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
/** Non-empty map, every key one of `keys`, every value in [0,1], and it contains `must`. */
const validProbs = (p: unknown, keys: string[], must: string): p is Record<string, number> =>
  !!p &&
  typeof p === 'object' &&
  !Array.isArray(p) &&
  Object.keys(p).length > 0 &&
  Object.keys(p).every((k) => keys.includes(k)) &&
  Object.hasOwn(p, must) &&
  Object.values(p).every(unit);

/** Keeps only answers that match their question; anything invalid is omitted ("no answer"). Never throws. */
export function sanitizeAnswers(
  questions: Record<string, DeciderQuestion>,
  raw: Record<string, unknown>,
): Record<string, DeciderAnswer> {
  const out: Record<string, DeciderAnswer> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, q] of Object.entries(questions)) {
    const a = (raw as Record<string, any>)[id];
    if (!a || typeof a !== 'object' || a.type !== q.type) continue;
    if (q.type === 'yesno') {
      if (unit(a.p)) out[id] = { type: 'yesno', p: a.p };
    } else if (q.type === 'choice') {
      if (
        typeof a.choice === 'string' &&
        Object.hasOwn(q.options, a.choice) &&
        validProbs(a.probabilities, Object.keys(q.options), a.choice) &&
        unit(a.confidence)
      ) {
        out[id] = { type: 'choice', choice: a.choice, probabilities: a.probabilities, confidence: a.confidence };
      }
    } else if (
      Number.isInteger(a.score) &&
      a.score >= 0 &&
      a.score < q.levels.length &&
      validProbs(a.probabilities, q.levels, q.levels[a.score]) &&
      unit(a.confidence)
    ) {
      out[id] = { type: 'score', score: a.score, probabilities: a.probabilities, confidence: a.confidence };
    }
  }
  return out;
}
