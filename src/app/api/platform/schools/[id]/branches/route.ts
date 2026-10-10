import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { createBranch } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(1).max(200) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new DomainError('NOT_FOUND');
  const body = await readJson(req, Body);
  return json(await createBranch(actor, { schoolId: id, name: body.name }), { status: 201 });
});
