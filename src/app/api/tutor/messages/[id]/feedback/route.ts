import { z } from 'zod';
import { handle, readJson, requireActor } from '@/lib/http';
import { submitFeedback } from '@/modules/tutor';

export const dynamic = 'force-dynamic';

const body = z.object({ rating: z.literal('down'), comment: z.string().max(2000).optional() });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  await submitFeedback(actor, id, await readJson(req, body));
  return new Response(null, { status: 204 });
});
