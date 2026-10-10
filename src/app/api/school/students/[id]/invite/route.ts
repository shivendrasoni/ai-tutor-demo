import { handle, json, requireActor } from '@/lib/http';
import { reissueInvite } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  const { inviteUrl } = await reissueInvite(actor, id);
  return json({ inviteUrl }, { status: 201 });
});
