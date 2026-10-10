/**
 * ASSUMED WIRE FORMAT. The vendor (TypeSafe, https://docs.typesafe.ai) documents only a Python SDK, so the HTTP
 * mapping below is our best assumption and is not verified against the live API. Everything that depends on it
 * lives in this file; fix it here if the real API differs.
 *
 *   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer <key>
 *   request:  { model: 'jev-latest', state, questions: { [id]:
 *               {type:'choice', criteria: options} | {type:'score', criteria: levels} | {type:'noul', instructions: statement} } }
 *   response: { answers: { [id]: { choice?, score?, probabilities, confidence? } | { answer, probabilities } } }
 *             a 'noul' (yes/no) answer maps to p = probabilities.noul.
 */
import { confidenceFrom, sanitizeAnswers, type Decider, type DeciderAnswer, type DeciderQuestion } from './types';

const URL = 'https://api.typesafe.ai/v1/systemone';

export class JevDecider implements Decider {
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  constructor(private o: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.fetchFn = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 500;
  }

  async decide(state: string, questions: Record<string, DeciderQuestion>): Promise<Record<string, DeciderAnswer>> {
    const body = {
      model: 'jev-latest',
      state,
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [
          id,
          q.type === 'choice'
            ? { type: 'choice', criteria: q.options }
            : q.type === 'score'
              ? { type: 'score', criteria: q.levels }
              : { type: 'noul', instructions: q.statement },
        ]),
      ),
    };
    // AbortController + setTimeout (rather than AbortSignal.timeout) so the 500 ms budget is testable with fake timers.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('jev timeout')), this.timeoutMs);
    let json: unknown;
    try {
      const res = await this.fetchFn(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`jev http ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const answers = (json as { answers?: unknown } | null)?.answers;
    if (!answers || typeof answers !== 'object') throw new Error('jev: unparseable response');
    return sanitizeAnswers(questions, this.map(questions, answers as Record<string, any>));
  }

  private map(questions: Record<string, DeciderQuestion>, answers: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      const a = answers[id];
      if (!a || typeof a !== 'object') continue;
      const probs = a.probabilities && typeof a.probabilities === 'object' ? (a.probabilities as Record<string, number>) : {};
      if (q.type === 'yesno') {
        out[id] = { type: 'yesno', p: probs.noul };
      } else if (q.type === 'choice') {
        out[id] = {
          type: 'choice',
          choice: a.choice,
          probabilities: probs,
          confidence: a.confidence ?? confidenceFrom(probs),
        };
      } else {
        out[id] = {
          type: 'score',
          score: a.score,
          probabilities: probs,
          confidence: a.confidence ?? confidenceFrom(probs),
        };
      }
    }
    return out;
  }
}
