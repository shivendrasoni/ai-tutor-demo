import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { rotateBranchCode, setBranchCodeEnabled } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ action: z.enum(['rotate', 'enable', 'disable']) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { action } = await readJson(req, Body);
  const { id } = await ctx.params;
  if (action === 'rotate') return json({ signupCode: await rotateBranchCode(actor, id) });
  await setBranchCodeEnabled(actor, id, action === 'enable');
  return json({});
});
