import { handle, json, requireActor } from '@/lib/http';
import { getArtifact } from '@/modules/studytools';
import { idParam, type IdCtx } from '../../_params';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, ctx: IdCtx) => {
  const actor = await requireActor(req);
  return json(await getArtifact(actor, await idParam(ctx)));
});
