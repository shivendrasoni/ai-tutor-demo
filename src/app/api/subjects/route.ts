import { handle, json, requireActor } from '@/lib/http';
import { listSubjects } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  return json(await listSubjects(actor));
});
