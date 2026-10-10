import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { rateLimits, sessions } from '@/db/schema';
import { hit } from '@/lib/rate-limit';
import { runLapse } from '../../scripts/lapse';
import { resetDb, seedTwoSchools } from '../helpers/db';

beforeEach(resetDb);
afterAll(closeDb);

describe('scripts/lapse runLapse()', () => {
  it('purges sessions that expired more than 7 days ago, keeping recent-expired and live ones', async () => {
    const seed = await seedTwoSchools();
    const now = new Date('2026-03-10T12:00:00Z');
    const day = 86_400_000;
    const mk = (hash: string, expiresAt: Date) => ({ userId: seed.a.studentId, tokenHash: hash, expiresAt });
    await withPlatform((tx) =>
      tx.insert(sessions).values([
        mk('long-expired', new Date(now.getTime() - 8 * day)),
        mk('just-expired', new Date(now.getTime() - 6 * day)),
        mk('live', new Date(now.getTime() + 20 * day)),
      ]),
    );
    const r = await runLapse(now);
    expect(r.purgedSessions).toBe(1);
    const left = await withPlatform((tx) => tx.select().from(sessions));
    expect(left.map((s) => s.tokenHash).sort()).toEqual(['just-expired', 'live']);
  });

  it('purges rate-limit windows older than a day and keeps recent ones', async () => {
    const now = new Date('2026-03-10T12:00:00Z');
    await hit('old', 5, 60_000, new Date('2026-03-08T12:00:00Z'));
    await hit('recent', 5, 60_000, new Date('2026-03-10T11:59:00Z'));
    const r = await runLapse(now);
    expect(r.purgedRateLimits).toBe(1);
    const rows = await withPlatform((tx) => tx.select().from(rateLimits));
    expect(rows.map((x) => x.key)).toEqual(['recent']);
  });
});
