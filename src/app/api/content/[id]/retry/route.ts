import { handle, json, requireActor } from '@/lib/http';
import { retryIngest } from '@/modules/content';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  await retryIngest(actor, id);
  return json({});
});
