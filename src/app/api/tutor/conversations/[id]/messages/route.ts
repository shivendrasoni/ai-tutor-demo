import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { toSse } from '@/lib/sse';
import { getMessages, runTurn } from '@/modules/tutor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const sendBody = z.object({ text: z.string().trim().min(1).max(4000) });

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  return json(await getMessages(actor, id));
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  const { text } = await readJson(req, sendBody);
  return toSse(runTurn(actor, id, text, { signal: req.signal }), req.signal);
});
