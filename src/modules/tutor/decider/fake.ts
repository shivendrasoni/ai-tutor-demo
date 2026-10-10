import { sanitizeAnswers, type Decider, type DeciderAnswer, type DeciderQuestion } from './types';

type Script =
  | Record<string, DeciderAnswer>
  | ((state: string, questions: Record<string, DeciderQuestion>) => Record<string, DeciderAnswer> | Error);

/** Test double: returns scripted answers (sanitized like the real deciders); a returned Error is thrown. */
export class FakeDecider implements Decider {
  calls: { state: string; questions: Record<string, DeciderQuestion> }[] = [];
  constructor(private script: Script) {}

  async decide(state: string, questions: Record<string, DeciderQuestion>) {
    this.calls.push({ state, questions });
    const r = typeof this.script === 'function' ? this.script(state, questions) : this.script;
    if (r instanceof Error) throw r;
    return sanitizeAnswers(questions, r);
  }
}
