import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { skills } from '@/db/schema';
import { getSkillByKey, listSkills, SEED_SKILLS, seedSkills, type SeedSkill } from '@/modules/tutor/skills';

beforeAll(async () => {
  await seedSkills();
});
afterEach(async () => {
  await withPlatform((tx) => tx.update(skills).set({ enabled: true, models: {} }).where(eq(skills.key, 'explain')));
});

describe('skills', () => {
  it('seedSkills is idempotent: re-run does not duplicate', async () => {
    await seedSkills();
    await seedSkills();
    const all = await listSkills('chat');
    expect(all.map((s) => s.key).sort()).toEqual(['explain', 'socratic']);
    expect(all.every((s) => s.tools.length === 1 && s.tools[0] === 'search_curriculum')).toBe(true);
  });
  it('socratic instructions withhold final answers until an attempt; explain may give answers', () => {
    const s = SEED_SKILLS.find((x) => x.key === 'socratic')!;
    expect(s.instructions).toMatch(/one step at a time/i);
    expect(s.instructions).toMatch(/never state the final answer/i);
    expect(s.instructions).toMatch(/hint, not the answer/i);
    expect(SEED_SKILLS.find((x) => x.key === 'explain')!.instructions).toMatch(/may give (the )?answers/i);
  });
  it('re-seeding does not overwrite operator-set models or enabled', async () => {
    await withPlatform((tx) =>
      tx.update(skills).set({ enabled: false, models: { standard: 'openai/x' } }).where(eq(skills.key, 'explain')),
    );
    await seedSkills();
    const row = await getSkillByKey('explain');
    expect(row?.enabled).toBe(false);
    expect(row?.models).toEqual({ standard: 'openai/x' });
  });
  it('listSkills(kind) filters by kind and skips disabled', async () => {
    expect((await listSkills('generator')).map((s) => s.key)).toEqual([
      'last_night_notes_generator', 'mock_exam_generator', 'practice_test_generator', 'study_notes_generator',
    ]);
    expect((await listSkills('grader')).map((s) => s.key)).toEqual(['answer_grader']);
    await withPlatform((tx) => tx.update(skills).set({ enabled: false }).where(eq(skills.key, 'explain')));
    expect((await listSkills('chat')).map((s) => s.key)).toEqual(['socratic']);
    expect((await listSkills()).map((s) => s.key)).not.toContain('explain');
    expect((await getSkillByKey('explain'))?.key).toBe('explain');
    expect(await getSkillByKey('nope')).toBeNull();
  });

  it('re-seed updates outputSchema/providerOptions, keeps operator models; extra skills are upserted', async () => {
    await withPlatform((tx) => tx.update(skills).set({ models: { standard: 'openai/x' } }).where(eq(skills.key, 'explain')));
    const extra: SeedSkill = {
      key: 'quiz-gen', name: 'Quiz', kind: 'generator', instructions: 'i', models: {}, tools: [],
      outputSchema: { v: 1 }, providerOptions: { openai: { a: 1 } }, enabled: true,
    };
    await seedSkills([extra]);
    await seedSkills([{ ...extra, outputSchema: { v: 2 }, providerOptions: { openai: { a: 2 } } }]);
    const q = await getSkillByKey('quiz-gen');
    expect(q).toMatchObject({ outputSchema: { v: 2 }, providerOptions: { openai: { a: 2 } } });
    expect((await getSkillByKey('explain'))!.models).toEqual({ standard: 'openai/x' });
    await withPlatform((tx) => tx.delete(skills).where(eq(skills.key, 'quiz-gen')));
  });
});
