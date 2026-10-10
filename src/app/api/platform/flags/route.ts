import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { listFlagged } from '@/modules/analytics';

export const dynamic = 'force-dynamic';

const Query = z.object({ status: z.enum(['open', 'reviewed']).default('open') });

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { status } = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Invalid filters');
  const rows = await listFlagged(actor, { status });
  return json({ flags: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
});
