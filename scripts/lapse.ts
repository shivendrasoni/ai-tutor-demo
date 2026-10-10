import './env';
import { pathToFileURL } from 'node:url';
import { closeDb } from '@/db/client';
import { redactError } from '@/lib/redact';
import { purgeRateLimits } from '@/lib/rate-limit';
import { lapseExpired } from '@/modules/enrollment';
import { purgeExpiredSessions } from '@/modules/tenancy';

const DAY = 86_400_000;

export type LapseResult = { lapsed: number; purgedRateLimits: number; purgedSessions: number };

/** Daily backstop: lapses expired subscriptions and purges stale rate-limit windows and long-expired sessions. */
export async function runLapse(now: Date = new Date()): Promise<LapseResult> {
  const lapsed = await lapseExpired(now);
  const purgedRateLimits = await purgeRateLimits(new Date(now.getTime() - DAY));
  const purgedSessions = await purgeExpiredSessions(new Date(now.getTime() - 7 * DAY));
  return { lapsed, purgedRateLimits, purgedSessions };
}

async function main(): Promise<number> {
  try {
    console.log(JSON.stringify(await runLapse(new Date())));
    return 0;
  } catch (err) {
    console.error('lapse failed:', redactError(err));
    return 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
