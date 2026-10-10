import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { setExclusion } from '@/modules/content';

export const dynamic = 'force-dynamic';

const Body = z.object({ branchId: z.uuid(), contentItemId: z.uuid(), excluded: z.boolean() });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  await setExclusion(actor, await readJson(req, Body));
  return json({});
});
