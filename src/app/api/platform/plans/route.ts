import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { createPlan, listActivePlans } from '@/modules/enrollment';
import { requirePlatform } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  interval: z.enum(['monthly', 'annual']),
  priceMinor: z.number().int().nonnegative().max(2147483647),
  currency: z.string().trim().length(3).optional(),
});

export const GET = handle(async (req: Request) => {
  requirePlatform(await requireActor(req));
  return json({ plans: await listActivePlans() });
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  return json(await createPlan(actor, body), { status: 201 });
});
