/** Daily cron job: lapses subscriptions whose period ended and purges stale rows. Usage: pnpm job:lapse */
import './env';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { closeDb } from '@/db/client';
import { purgeRateLimits } from '@/lib/rate-limit';
import { lapseExpired } from '@/modules/enrollment';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One maintenance pass. Exported for tests. */
export async function runLapse(now: Date = new Date()) {
  const lapsed = await lapseExpired(now);
  const purgedRateLimits = await purgeRateLimits(new Date(now.getTime() - DAY_MS));
  return { lapsed, purgedRateLimits };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  let code = 0;
  try {
    console.log(JSON.stringify(await runLapse()));
  } catch (e) {
    console.error(`Error: ${(e as Error)?.message ?? String(e)}`);
    code = 1;
  } finally {
    await closeDb();
  }
  process.exit(code);
}
