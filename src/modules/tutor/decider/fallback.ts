import type { Decider, DeciderAnswer, DeciderQuestion } from './types';

export class FallbackDecider implements Decider {
  lastRun = { fellBack: false, primaryError: false, secondaryError: false };
  constructor(
    private primary: Decider,
    private secondary: Decider,
  ) {}

  async decide(state: string, questions: Record<string, DeciderQuestion>): Promise<Record<string, DeciderAnswer>> {
    const run = { fellBack: false, primaryError: false, secondaryError: false };
    this.lastRun = run;
    try {
      return await this.primary.decide(state, questions);
    } catch {
      run.fellBack = true;
      run.primaryError = true;
    }
    try {
      return await this.secondary.decide(state, questions);
    } catch (e) {
      run.secondaryError = true;
      throw e;
    }
  }
}
