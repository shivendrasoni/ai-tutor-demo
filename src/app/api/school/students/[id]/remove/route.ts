import { handle, json, requireActor } from '@/lib/http';
import { removeStudent } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  await removeStudent(actor, id);
  return json({ ok: true });
});
