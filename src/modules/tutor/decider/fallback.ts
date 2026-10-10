import type { Decider, DeciderRun, DeciderAnswer, DeciderQuestion } from './types';

export class FallbackDecider implements Decider {
  constructor(
    private primary: Decider,
    private secondary: Decider,
  ) {}

  async decide(state: string, questions: Record<string, DeciderQuestion>, meta?: DeciderRun): Promise<Record<string, DeciderAnswer>> {
    const run = meta ?? { fellBack: false, primaryError: false, secondaryError: false };
    run.fellBack = run.primaryError = run.secondaryError = false;
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
