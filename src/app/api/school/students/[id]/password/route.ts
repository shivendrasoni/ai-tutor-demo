import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { resetStudentPassword } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// Shape check only; the service owns the strength rules.
const Body = z.object({ password: z.string().max(128) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  const { password } = await readJson(req, Body);
  await resetStudentPassword(actor, id, password);
  return json({ ok: true });
});
