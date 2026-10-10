import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { artifacts, skills } from '@/db/schema';
import type { Actor } from '@/modules/tenancy/actor';
import { activate } from './tutor';

/** Sets the student's profile to `active` (platform context). Delegates to the tutor helper. */
export const activateStudent = (actor: Actor): Promise<void> => activate(actor);

/** Returns (creating once) a generator skill row for artifact fixtures. */
async function fixtureSkillId(key = 'practice_test_generator'): Promise<string> {
  return withPlatform(async (tx) => {
    const [found] = await tx.select({ id: skills.id }).from(skills).where(eq(skills.key, key));
    if (found) return found.id;
    const [row] = await tx
      .insert(skills)
      .values({ key, name: key, kind: 'generator', instructions: 'fixture' })
      .returning({ id: skills.id });
    return row.id;
  });
}

type ArtifactInsert = typeof artifacts.$inferInsert;

/** Inserts an artifact directly (platform context). Defaults to a ready practice test with content. */
export async function insertArtifact(
  schoolId: string,
  studentId: string,
  subjectId: string,
  over: Partial<ArtifactInsert> = {},
): Promise<typeof artifacts.$inferSelect> {
  const skillId = over.skillId ?? (await fixtureSkillId());
  const [row] = await withPlatform((tx) =>
    tx
      .insert(artifacts)
      .values({
        schoolId,
        studentId,
        skillId,
        type: 'practice_test',
        subjectId,
        status: 'ready',
        params: { chapterTitles: {} },
        content: { questions: [] },
        ...over,
      })
      .returning(),
  );
  return row;
}
