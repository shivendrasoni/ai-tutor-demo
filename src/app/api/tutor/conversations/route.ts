import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { createConversation, listConversations } from '@/modules/tutor';

export const dynamic = 'force-dynamic';

const createBody = z.object({ skillKey: z.string().min(1), subjectId: z.string().uuid().optional() });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, createBody);
  return json(await createConversation(actor, body), { status: 201 });
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  return json(await listConversations(actor));
});
