import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { TutorModel } from '../models/registry';
import { confidenceFrom, sanitizeAnswers, type Decider, type DeciderAnswer, type DeciderQuestion } from './types';

const probs = (keys: string[]) =>
  z.object({ probabilities: z.object(Object.fromEntries(keys.map((k) => [k, z.number()]))) });

const argmax = (p: Record<string, number>) =>
  Object.entries(p).reduce<[string, number] | null>((best, e) => (!best || e[1] > best[1] ? e : best), null)?.[0];

export class LlmDecider implements Decider {
  constructor(private o: { model: TutorModel }) {}

  async decide(state: string, questions: Record<string, DeciderQuestion>): Promise<Record<string, DeciderAnswer>> {
    const shape: Record<string, z.ZodType> = {};
    const lines: string[] = [];
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === 'choice') {
        shape[id] = probs(Object.keys(q.options));
        lines.push(
          `- ${id}: ${q.instructions}\n  Give a probability (0 to 1, summing to 1) for each option:\n${Object.entries(q.options)
            .map(([k, v]) => `    ${k}: ${v}`)
            .join('\n')}`,
        );
      } else if (q.type === 'score') {
        shape[id] = probs(q.levels);
        lines.push(
          `- ${id}: ${q.instructions}\n  Give a probability (0 to 1, summing to 1) for each level: ${q.levels.join(', ')}`,
        );
      } else {
        shape[id] = z.object({ p: z.number() });
        lines.push(`- ${id}: probability (0 to 1) that this is true: ${q.statement}`);
      }
    }
    const { output } = await generateText({
      model: this.o.model,
      output: Output.object({ schema: z.object(shape) }),
      temperature: 0,
      system:
        'You classify a student conversation for a school tutor. Answer every question with probabilities only.',
      prompt: `Conversation:\n${state}\n\nQuestions:\n${lines.join('\n')}`,
    });
    const raw: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(questions)) {
      const a = (output as Record<string, any> | undefined)?.[id];
      if (!a) continue;
      if (q.type === 'yesno') {
        raw[id] = { type: 'yesno', p: a.p };
      } else {
        const p = a.probabilities as Record<string, number>;
        const top = argmax(p);
        if (top === undefined) continue;
        raw[id] =
          q.type === 'choice'
            ? { type: 'choice', choice: top, probabilities: p, confidence: confidenceFrom(p) }
            : { type: 'score', score: q.levels.indexOf(top), probabilities: p, confidence: confidenceFrom(p) };
      }
    }
    return sanitizeAnswers(questions, raw);
  }
}
