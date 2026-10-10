import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles } from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import type { Actor } from '@/modules/tenancy/actor';

/** Sets the student's profile to `active` (platform context), so the student may chat. */
export async function activate(actor: Actor): Promise<void> {
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, actor.userId)),
  );
}

/** Seeds the global tutor skills (`socratic`, `explain`). */
export async function seedTutorSkills(): Promise<void> {
  await seedSkills();
}
