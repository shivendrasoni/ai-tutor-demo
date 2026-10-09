import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform } from '@/db/client';
import { plans } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { requirePlatform, type Actor } from '@/modules/tenancy';

export type Plan = typeof plans.$inferSelect;

const PlanInput = z.object({
  name: z.string().trim().min(1).max(100),
  interval: z.enum(['monthly', 'annual']),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
});

export async function createPlan(
  actor: Actor,
  input: { name: string; interval: 'monthly' | 'annual'; priceMinor: number; currency?: string },
): Promise<{ id: string }> {
  requirePlatform(actor);
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid plan', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const [row] = await withPlatform((tx) => tx.insert(plans).values(parsed.data).returning({ id: plans.id }));
  return row;
}

export async function listActivePlans(): Promise<Plan[]> {
  return withPlatform((tx) =>
    tx.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.priceMinor), asc(plans.name)),
  );
}
