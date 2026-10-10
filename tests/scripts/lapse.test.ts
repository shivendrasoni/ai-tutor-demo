import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { hit } from '@/lib/rate-limit';
import { runLapse } from '../../scripts/lapse';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);
afterAll(closeDb);

describe('scripts/lapse runLapse()', () => {
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
