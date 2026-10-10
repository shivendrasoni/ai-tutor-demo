import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { studentProfiles } from '@/db/schema';
import type { Actor } from '@/modules/tenancy/actor';

/** Sets the student's profile to `active` (platform context), so the student may chat. */
export async function activate(actor: Actor): Promise<void> {
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, actor.userId)),
  );
}

/** Seeds the global tutor skills (`socratic`, `explain`). `seedSkills` arrives in Task 5, so import it lazily. */
export async function seedTutorSkills(): Promise<void> {
  const path = '@/modules/tutor/skills'; // not a literal: the module does not exist until Task 5
  const mod = (await import(/* @vite-ignore */ path)) as { seedSkills: () => Promise<void> };
  await mod.seedSkills();
}
