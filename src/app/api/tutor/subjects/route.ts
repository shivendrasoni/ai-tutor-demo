import { handle, json, requireActor } from '@/lib/http';
import { listChatSubjects } from '@/modules/tutor';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  return json(await listChatSubjects(actor));
});
