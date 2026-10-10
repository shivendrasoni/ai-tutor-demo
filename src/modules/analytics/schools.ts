import { sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { listPendingSubscriptions } from '@/modules/enrollment';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { costSummary } from './cost';

export type SchoolListing = {
  id: string;
  name: string;
  board: string;
  branches: { id: string; name: string; signupCode: string; signupCodeEnabled: boolean }[];
};

/** Platform-only. Schools by name, each with its branches by name (`[]` when none). */
export async function listSchools(actor: Actor): Promise<SchoolListing[]> {
  requirePlatform(actor);
  return withPlatform(async (tx) => {
    const s = await tx.execute(sql`select id, name, board from schools order by name, id`);
    const b = await tx.execute(sql`
      select id, school_id as "schoolId", name, signup_code as "signupCode", signup_code_enabled as "signupCodeEnabled"
      from branches order by name, id`);
    return s.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      board: r.board as string,
      branches: b.rows
        .filter((x) => x.schoolId === r.id)
        .map((x) => ({
          id: x.id as string,
          name: x.name as string,
          signupCode: x.signupCode as string,
          signupCodeEnabled: x.signupCodeEnabled as boolean,
        })),
    }));
  });
}

/** Platform-only. Counts reuse the same sources as the pending queue, flag queue and cost summary. */
export async function platformOverview(
  actor: Actor,
  args?: { now?: Date },
): Promise<{ pendingPayments: number; openFlags: number; cost30d: number }> {
  requirePlatform(actor);
  const pending = await listPendingSubscriptions(actor);
  const flagged = await withPlatform(async (tx) => {
    const r = await tx.execute(
      sql`select count(*)::int as n from messages where flagged = true and reviewed_at is null`,
    );
    return Number(r.rows[0].n);
  });
  const cost = await costSummary(actor, { days: 30, now: args?.now });
  return {
    pendingPayments: pending.length,
    openFlags: flagged,
    cost30d: cost.bySchool.reduce((n, s) => n + s.cost, 0),
  };
}
