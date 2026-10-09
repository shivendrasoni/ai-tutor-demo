import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { completeInvite, getInvite } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const invite = await getInvite(token);
  if (!invite) throw new DomainError('INVITE_INVALID', 'This invite is invalid or has expired');
  return json(invite);
});

const Body = z.object({
  planId: z.string(),
  username: z.string(),
  password: z.string(),
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const body = await readJson(req, Body);
  const r = await completeInvite({ token, ...body });
  return json({ studentUserId: r.studentUserId, subscriptionId: r.subscriptionId });
});
