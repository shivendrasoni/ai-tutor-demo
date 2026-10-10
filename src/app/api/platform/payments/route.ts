import { z } from 'zod';
import { DomainError } from '@/lib/errors';
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
  const paidAt = new Date(body.paidAt);
  // Reject only dates after today (UTC); any time earlier today is fine.
  if (paidAt.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) {
    throw new DomainError('VALIDATION', 'paidAt cannot be in the future');
  }
  const r = await recordPayment(actor, {
    subscriptionId: body.subscriptionId,
    amountMinor: body.amountMinor,
    currency: body.currency ?? 'INR',
    externalRef: body.externalRef,
    paidAt,
  });
  return json({ periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString() });
});
