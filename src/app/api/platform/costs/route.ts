import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { costSummary } from '@/modules/analytics';

export const dynamic = 'force-dynamic';

const Query = z.object({ days: z.enum(['7', '30']).default('7').transform((d) => Number(d) as 7 | 30) });

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { days } = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'days must be 7 or 30');
  return json(await costSummary(actor, { days }));
});
