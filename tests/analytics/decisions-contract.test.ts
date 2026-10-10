import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { conversations, messages, usageDaily } from '@/db/schema';
import { routingStats } from '@/modules/analytics';
import { createConversation, FakeDecider, getMessages, runTurn, type TurnEvent } from '@/modules/tutor';
import { confidenceFrom, type DeciderAnswer } from '@/modules/tutor/decider/types';
import { INTENTS } from '@/modules/tutor/routing';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activate, resetTutorFakes, scriptedModel, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await seedTutorSkills();
  await activate(seed.a.student);
});
beforeEach(async () => {
  await withPlatform(async (tx) => {
    await tx.delete(usageDaily);
    await tx.delete(messages);
    await tx.delete(conversations);
  });
});
afterEach(resetTutorFakes);
afterAll(closeDb);

const pick = (choice: string, p: number): DeciderAnswer => {
  const options = [...INTENTS];
  const probabilities: Record<string, number> = { [choice]: p, [options.find((o) => o !== choice)!]: 1 - p };
  return { type: 'choice', choice, probabilities, confidence: confidenceFrom(probabilities) };
};
const yesno = (p: number): DeciderAnswer => ({ type: 'yesno', p });
const answers = (intent: string): Record<string, DeciderAnswer> => ({
  intent: pick(intent, 0.97), out_of_syllabus: yesno(0.1), needs_review: yesno(0.1),
});

async function turn(intent: string) {
  useTutorFakes({ model: scriptedModel([{ text: 'Plants make food.' }]), decider: new FakeDecider(answers(intent)) });
  const student = seed.a.student;
  const { id } = await createConversation(student, { skillKey: 'socratic' });
  const events: TurnEvent[] = [];
  for await (const e of runTurn(student, id, 'hello')) events.push(e);
  return (await getMessages(student, id)).filter((m) => m.role === 'assistant').at(-1)!;
}

describe('messages.decisions contract read by routingStats', () => {
  it('runTurn writes every decisions key routingStats reads', async () => {
    const normalTurn = await turn('learn_concept');
    const offTopicTurn = await turn('off_topic');
    expect(Object.keys(normalTurn.decisions!)).toEqual(
      expect.arrayContaining(['tier', 'filterFallback', 'deciderError', 'deciderProvider', 'deciderFellBack']),
    );
    expect(Object.keys(offTopicTurn.decisions!)).toEqual(
      expect.arrayContaining(['tier', 'fixedReply', 'filterFallback', 'deciderError', 'deciderProvider', 'deciderFellBack']),
    );
    expect(offTopicTurn.decisions!.fixedReply).toBe('off_topic');
    expect(offTopicTurn.decisions!.tier).toBeNull();
    expect(['standard', 'advanced']).toContain(normalTurn.decisions!.tier);
    expect(typeof normalTurn.decisions!.filterFallback).toBe('boolean');
    expect(typeof normalTurn.decisions!.deciderError).toBe('boolean');
    expect(typeof normalTurn.decisions!.deciderFellBack).toBe('boolean');
  });

  it('routingStats reads the real written rows correctly', async () => {
    await turn('learn_concept');
    await turn('off_topic');
    const stats = await routingStats(seed.platform, { days: 7 });
    expect(stats).toEqual({
      turns: 2, advancedShare: 0, offTopicBlocks: 1, unsafeBlocks: 0, filterFallbacks: 0, deciderErrors: 0, deciderFallbacks: 0,
    });
  });
});
