import { handle, json, requireActor } from '@/lib/http';
import { startAttempt } from '@/modules/studytools';
import { idParam, type IdCtx } from '../../../_params';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const actor = await requireActor(req);
  return json(await startAttempt(actor, await idParam(ctx)), { status: 201 });
});
