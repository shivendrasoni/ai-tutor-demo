import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { recordPayment } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// Shape check only; recordPayment owns authorization, amount and paidAt bounds, and idempotency.
const Body = z.object({
  subscriptionId: z.string().max(64),
  amountMinor: z.number().int().positive().max(2147483647),
  currency: z.string().max(3).default('INR'),
  externalRef: z.string().max(200).optional(),
  paidAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  return json(await recordPayment(actor, body));
});
