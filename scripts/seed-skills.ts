/** Upserts the global tutor skills. Usage: pnpm seed:skills */
import './env';
import { closeDb } from '@/db/client';
import { SEED_SKILLS, seedSkills } from '@/modules/tutor/skills';

let code = 0;
try {
  await seedSkills();
  console.log(JSON.stringify({ seeded: SEED_SKILLS.map((s) => s.key) }));
} catch (e) {
  console.error(`Error: ${(e as Error)?.message ?? String(e)}`);
  code = 1;
} finally {
  await closeDb();
}
process.exit(code);
