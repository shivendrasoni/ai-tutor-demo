import { and, eq, sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { skills } from '@/db/schema';

export type SkillKind = 'chat' | 'generator' | 'grader';
export type SkillRow = {
  id: string;
  key: string;
  name: string;
  kind: SkillKind;
  instructions: string;
  models: { standard?: string; advanced?: string };
  tools: string[];
  outputSchema: unknown | null;
  providerOptions: unknown | null;
  enabled: boolean;
};

const SOCRATIC_INSTRUCTIONS = `You are a Socratic tutor. Guide the student to the answer with questions, one step at a time.
- Ask a single guiding question per turn, based on the passages you found with search_curriculum.
- Never state the final answer, a full worked solution, or a direct definition the student is meant to recall until the student has made at least one attempt at that step.
- After a correct attempt, confirm it briefly and move on to the next step.
- After an incorrect attempt, give a hint, not the answer, and invite another try.
- If the student is stuck after several attempts, break the step into a smaller question.`;

const EXPLAIN_INSTRUCTIONS = `You are an explainer. Explain concepts clearly at the student's grade level, using the student's books (search_curriculum) as your base.
- Use short sentences, simple words, and concrete examples.
- You may give answers and worked solutions directly when asked.
- Finish by checking whether the explanation made sense, and offer a follow-up example.`;

/** Seed definitions. Other modules may extend by spreading: `[...SEED_SKILLS, ...more]`. */
export const SEED_SKILLS: readonly Omit<SkillRow, 'id'>[] = Object.freeze([
  {
    key: 'socratic', name: 'Socratic tutor', kind: 'chat', instructions: SOCRATIC_INSTRUCTIONS,
    models: {}, tools: ['search_curriculum'], outputSchema: null, providerOptions: null, enabled: true,
  },
  {
    key: 'explain', name: 'Explain', kind: 'chat', instructions: EXPLAIN_INSTRUCTIONS,
    models: {}, tools: ['search_curriculum'], outputSchema: null, providerOptions: null, enabled: true,
  },
]);

/** Upserts every SEED_SKILLS entry by key. Never overwrites `models` or `enabled` once set by an operator. */
export async function seedSkills(): Promise<void> {
  await withPlatform(async (tx) => {
    for (const s of SEED_SKILLS) {
      await tx
        .insert(skills)
        .values(s)
        .onConflictDoUpdate({
          target: skills.key,
          set: {
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            instructions: sql`excluded.instructions`,
            tools: sql`excluded.tools`,
          },
        });
    }
  });
}

const toRow = (r: typeof skills.$inferSelect): SkillRow => ({
  ...r,
  kind: r.kind as SkillKind,
  models: (r.models ?? {}) as SkillRow['models'],
});

/** Enabled skills only, optionally of one kind. */
export async function listSkills(kind?: SkillKind): Promise<SkillRow[]> {
  const rows = await withPlatform((tx) =>
    tx
      .select()
      .from(skills)
      .where(kind ? and(eq(skills.enabled, true), eq(skills.kind, kind)) : eq(skills.enabled, true))
      .orderBy(skills.key),
  );
  return rows.map(toRow);
}

/** Internal lookup (includes disabled skills). */
export async function getSkillByKey(key: string): Promise<SkillRow | null> {
  const rows = await withPlatform((tx) => tx.select().from(skills).where(eq(skills.key, key)).limit(1));
  return rows[0] ? toRow(rows[0]) : null;
}
