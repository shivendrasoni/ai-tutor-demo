import { handle, json, requireActor } from '@/lib/http';
import { listPendingSubscriptions } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const rows = await listPendingSubscriptions(actor);
  return json({ pending: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
});
