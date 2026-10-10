import { handle, json, requireActor } from '@/lib/http';
import { listPendingSubscriptions } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => json({ pending: await listPendingSubscriptions(await requireActor(req)) }));
