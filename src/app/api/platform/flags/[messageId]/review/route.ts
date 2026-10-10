import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, requireActor } from '@/lib/http';
import { markReviewed } from '@/modules/analytics';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ messageId: string }> }) => {
  const actor = await requireActor(req);
  const { messageId } = await ctx.params;
  if (!z.uuid().safeParse(messageId).success) throw new DomainError('NOT_FOUND');
  await markReviewed(actor, messageId);
  return new Response(null, { status: 204 });
});
