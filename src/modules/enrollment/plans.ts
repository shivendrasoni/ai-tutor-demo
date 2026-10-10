import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform } from '@/db/client';
import { plans } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import type { PlanInterval } from './periods';

export type Plan = { id: string; name: string; interval: PlanInterval; priceMinor: number; currency: string };

const PlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  interval: z.enum(['monthly', 'annual']),
  priceMinor: z.number().int().min(0).max(2147483647),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'),
});

export async function createPlan(
  actor: Actor,
  input: { name: string; interval: PlanInterval; priceMinor: number; currency?: string },
): Promise<{ id: string }> {
  requirePlatform(actor);
  const parsed = PlanSchema.safeParse({ ...input, currency: input.currency ?? undefined });
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid plan', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const [row] = await withPlatform((tx) => tx.insert(plans).values(parsed.data).returning({ id: plans.id }));
  return { id: row.id };
}

/** Active plans by price, then name. Global table: no tenant context needed. */
export async function listActivePlans(): Promise<Plan[]> {
  const rows = await withPlatform((tx) => tx.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.priceMinor), asc(plans.name), asc(plans.id)));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    interval: p.interval as PlanInterval,
    priceMinor: p.priceMinor,
    currency: p.currency,
  }));
}
