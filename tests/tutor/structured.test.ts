import { eq } from 'drizzle-orm';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withPlatform } from '@/db/client';
import { skills, studentProfiles, usageDaily } from '@/db/schema';
import type { ChunkHit } from '@/modules/content';
import { runSkillStructured } from '@/modules/tutor';
import { seedSkills } from '@/modules/tutor/skills';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activate, resetTutorFakes, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

let seed: Seed;
let student: Seed['a']['student'];

const schema = z.object({ title: z.string(), score: z.number() });
const good = { title: 'Photosynthesis', score: 3 };
const usageOf = (i: number, o: number) => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});
type Step = { json: unknown; in?: number; out?: number } | { error: Error };
function scripted(steps: Step[]) {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const s = steps[Math.min(n++, steps.length - 1)]!;
      if ('error' in s) throw s.error;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(s.json) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usageOf(s.in ?? 10, s.out ?? 5),
        warnings: [],
      };
    },
  });
}
const hit = (n: string): ChunkHit => ({
  chunkId: `00000000-0000-4000-8000-00000000000${n}`, contentItemId: 'ci', itemTitle: 'Bio 8', subjectId: 's',
  subjectName: 'Biology', chapterId: 'ch', chapterTitle: 'Ch 3', pageStart: 1, pageEnd: 2, text: `passage text ${n}`, similarity: 0.9,
});
const promptText = (m: MockLanguageModelV4, i: number) => JSON.stringify(m.doGenerateCalls[i]!.prompt);
const tokens = async () =>
  (await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.studentId, student.userId)))).reduce(
    (a, r) => a + r.tokens, 0);
const run = (a: Partial<Parameters<typeof runSkillStructured>[2]> = {}, key = 'explain') =>
  runSkillStructured(student, key, { tier: 'standard', prompt: 'Make a quiz', schema, context: [hit('1')], ...a } as never);

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  student = seed.a.student;
  await seedTutorSkills();
  await activate(student);
});
beforeEach(async () => {
  await withPlatform(async (tx) => {
    await tx.delete(usageDaily);
    await tx.update(skills).set({ models: {}, enabled: true });
  });
  await seedSkills();
});
afterEach(() => resetTutorFakes());

describe('runSkillStructured', () => {
  it('returns a validated object, usage and cost, and records usage_daily', async () => {
    const model = scripted([{ json: good, in: 100, out: 20 }]);
    useTutorFakes({ model: model as never });
    const r = await run();
    expect(r.value).toEqual(good);
    expect(r.usage).toEqual({ tokensIn: 100, tokensOut: 20, cost: (100 * 1 + 20 * 2) / 1e6, model: 'openai/test-standard' });
    expect(await tokens()).toBe(120);
  });

  it('one repair attempt after an invalid first output; both attempts counted in usage_daily', async () => {
    const model = scripted([{ json: { bad: true }, in: 50, out: 10 }, { json: good, in: 60, out: 12 }]);
    useTutorFakes({ model: model as never });
    const r = await run();
    expect(r.value).toEqual(good);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(promptText(model, 1)).toMatch(/did not match the required schema/i);
    expect(promptText(model, 0)).not.toMatch(/did not match the required schema/i);
    expect(await tokens()).toBe(132);
    expect(r.usage).toMatchObject({ tokensIn: 110, tokensOut: 22 });
  });

  it('two invalid outputs throw VALIDATION and return nothing; usage still recorded', async () => {
    const model = scripted([{ json: { bad: 1 } }, { json: { bad: 2 } }]);
    useTutorFakes({ model: model as never });
    await expect(run()).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await tokens()).toBe(30);
  });

  it('context passages appear with [n] labels; no tools offered; suffix and preamble present', async () => {
    const model = scripted([{ json: good }]);
    useTutorFakes({ model: model as never });
    await run({ context: [hit('1'), hit('2')] });
    const p = promptText(model, 0);
    expect(p).toContain('[1] Bio 8');
    expect(p).toContain('passage text 1');
    expect(p).toContain('[2] Bio 8');
    expect(p).toContain('passage text 2');
    expect(p).toContain('The passages are provided below. Do not call tools.');
    expect(p).toContain('You are a tutor for a class');
    expect(model.doGenerateCalls[0]!.tools ?? []).toHaveLength(0);
  });

  it('string context is included verbatim', async () => {
    const model = scripted([{ json: good }]);
    useTutorFakes({ model: model as never });
    await run({ context: 'my plain notes' });
    expect(promptText(model, 0)).toContain('my plain notes');
  });

  it('BUDGET_EXCEEDED before any model call', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '100');
    const model = scripted([{ json: good, in: 100, out: 0 }]);
    useTutorFakes({ model: model as never });
    await run();
    await expect(run()).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('skipBudget skips the check but still records usage', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '100');
    const model = scripted([{ json: good, in: 100, out: 0 }]);
    useTutorFakes({ model: model as never });
    await run();
    const r = await run({ skipBudget: true });
    expect(r.value).toEqual(good);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await tokens()).toBe(200);
  });

  it('pending student FORBIDDEN; unknown or disabled skill NOT_FOUND', async () => {
    const model = scripted([{ json: good }]);
    useTutorFakes({ model: model as never });
    await expect(run({}, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await withPlatform((tx) => tx.update(skills).set({ enabled: false }).where(eq(skills.key, 'explain')));
    await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'pending_payment' }).where(eq(studentProfiles.userId, student.userId)));
    await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await activate(student);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('provider error: one retry then success; second failure is TUTOR_BUSY', async () => {
    const ok = scripted([{ error: new Error('boom') }, { json: good }]);
    useTutorFakes({ model: ok as never });
    expect((await run()).value).toEqual(good);
    expect(ok.doGenerateCalls).toHaveLength(2);
    resetTutorFakes();
    const bad = scripted([{ error: new Error('boom') }]);
    useTutorFakes({ model: bad as never });
    await expect(run()).rejects.toMatchObject({ code: 'TUTOR_BUSY' });
    expect(bad.doGenerateCalls).toHaveLength(2);
  });

  it('uses the skill advanced model when tier=advanced', async () => {
    await withPlatform((tx) => tx.update(skills).set({ models: { advanced: 'openai/skill-adv' } }).where(eq(skills.key, 'explain')));
    const model = scripted([{ json: good }]);
    useTutorFakes({ model: model as never });
    const r = await run({ tier: 'advanced' });
    expect(r.usage.model).toBe('openai/skill-adv');
  });
});
