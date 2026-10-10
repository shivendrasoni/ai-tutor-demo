import { handle, json, requireActor } from '@/lib/http';
import { deleteContent } from '@/modules/content';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  await deleteContent(actor, id);
  return json({});
});
