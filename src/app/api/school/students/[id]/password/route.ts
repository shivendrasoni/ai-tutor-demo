import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { resetStudentPassword } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// resetStudentPassword owns the strength rules; the password is hashed and never returned.
const Body = z.object({ password: z.string().max(128) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const { id } = await ctx.params;
  await resetStudentPassword(actor, id, body.password);
  return json({ ok: true });
});
