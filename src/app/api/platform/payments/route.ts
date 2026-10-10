import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { recordPayment } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

const Body = z.object({
  subscriptionId: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().optional(),
  externalRef: z.string().optional(),
  paidAt: z.iso.datetime({ offset: true }),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const r = await recordPayment(actor, {
    subscriptionId: body.subscriptionId,
    amountMinor: body.amountMinor,
    currency: body.currency ?? 'INR',
    externalRef: body.externalRef,
    paidAt: new Date(body.paidAt),
  });
  return json({ periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString() });
});
