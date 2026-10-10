import { sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { assertDays } from './cost';
import { windowStart } from './window';

export type RoutingStats = {
  turns: number;
  advancedShare: number;
  offTopicBlocks: number;
  unsafeBlocks: number;
  filterFallbacks: number;
  deciderErrors: number;
  deciderFallbacks: number;
};

/**
 * Platform-only routing health over assistant `messages.decisions` (sub-project 3 as-built, ruling R-D3):
 * - turns: assistant messages in the window with non-null decisions (rows with null decisions are ignored).
 * - advancedShare: turns with tier = 'advanced' / turns with a non-null tier; 0 when that denominator is 0.
 *   Fixed replies have tier null, so they are turns but not part of the tier denominator.
 * - offTopicBlocks / unsafeBlocks: count of decisions.fixedReply = 'off_topic' / 'unsafe'.
 * - filterFallbacks / deciderErrors / deciderFallbacks: count of filterFallback / deciderError / deciderFellBack = true.
 *   deciderProvider is the CONFIGURED provider (not the one that answered), so fallbacks use deciderFellBack only.
 * A missing key counts as false.
 * deciderProvider may be 'mock' (MockDecider in keyless mock mode); no counter groups by provider, so 'mock' turns count like any other.
 */
export async function routingStats(actor: Actor, args: { days: 7 | 30; now?: Date }): Promise<RoutingStats> {
  requirePlatform(actor);
  const days = args?.days;
  assertDays(days);
  const start = windowStart(args.now ?? new Date(), days).toISOString();

  const res = await withPlatform((tx) =>
    tx.execute(sql`
      select
        count(*) as "turns",
        count(*) filter (where decisions->>'tier' = 'advanced') as "advanced",
        count(*) filter (where decisions->>'tier' is not null) as "tiered",
        count(*) filter (where decisions->>'fixedReply' = 'off_topic') as "offTopicBlocks",
        count(*) filter (where decisions->>'fixedReply' = 'unsafe') as "unsafeBlocks",
        count(*) filter (where decisions->>'filterFallback' = 'true') as "filterFallbacks",
        count(*) filter (where decisions->>'deciderError' = 'true') as "deciderErrors",
        count(*) filter (where decisions->>'deciderFellBack' = 'true') as "deciderFallbacks"
      from messages
      where role = 'assistant' and decisions is not null and created_at >= ${start}::timestamptz`),
  );
  const r = res.rows[0] ?? {};
  const tiered = Number(r.tiered ?? 0);
  return {
    turns: Number(r.turns ?? 0),
    advancedShare: tiered > 0 ? Number(r.advanced) / tiered : 0,
    offTopicBlocks: Number(r.offTopicBlocks ?? 0),
    unsafeBlocks: Number(r.unsafeBlocks ?? 0),
    filterFallbacks: Number(r.filterFallbacks ?? 0),
    deciderErrors: Number(r.deciderErrors ?? 0),
    deciderFallbacks: Number(r.deciderFallbacks ?? 0),
  };
}
