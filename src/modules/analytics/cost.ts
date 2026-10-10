import { sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { windowStart, windowStartDate } from './window';

export type CostSummary = {
  bySchool: { schoolId: string; name: string; cost: number; tokens: number; students: number }[];
  bySkill: { skillKey: string; cost: number; tokens: number; turns: number }[];
};

export function assertDays(days: unknown): asserts days is 7 | 30 {
  if (days !== 7 && days !== 30) throw new DomainError('VALIDATION', 'days must be 7 or 30');
}

/**
 * Platform-only. `bySchool` comes from `usage_daily` (includes study-tool generation cost) and lists
 * every school, with zeros when it has no usage. `bySkill` comes from assistant messages that ran a model
 * (`model is not null`; fixed replies are excluded), so it does not include non-message generation cost.
 */
export async function costSummary(actor: Actor, args: { days: 7 | 30; now?: Date }): Promise<CostSummary> {
  requirePlatform(actor);
  const days = args?.days;
  assertDays(days);
  const now = args.now ?? new Date();
  const startDate = windowStartDate(now, days);
  const startTs = windowStart(now, days).toISOString();

  return withPlatform(async (tx) => {
    const schools = await tx.execute(sql`
      select s.id as "schoolId", s.name as "name",
        coalesce(sum(u.cost), 0) as "cost", coalesce(sum(u.tokens), 0) as "tokens",
        count(distinct u.student_id) as "students"
      from schools s
      left join usage_daily u on u.school_id = s.id and u.date >= ${startDate}::date
      group by s.id, s.name
      order by coalesce(sum(u.cost), 0) desc, s.name, s.id`);
    const skills = await tx.execute(sql`
      select k.key as "skillKey", coalesce(sum(m.cost), 0) as "cost",
        coalesce(sum(m.tokens_in + m.tokens_out), 0) as "tokens", count(*) as "turns"
      from messages m
      join conversations c on c.id = m.conversation_id
      join skills k on k.id = c.skill_id
      where m.role = 'assistant' and m.model is not null and m.created_at >= ${startTs}::timestamptz
      group by k.key
      order by coalesce(sum(m.cost), 0) desc, k.key`);
    return {
      bySchool: schools.rows.map((r) => ({
        schoolId: r.schoolId as string,
        name: r.name as string,
        cost: Number(r.cost),
        tokens: Number(r.tokens),
        students: Number(r.students),
      })),
      bySkill: skills.rows.map((r) => ({
        skillKey: r.skillKey as string,
        cost: Number(r.cost),
        tokens: Number(r.tokens),
        turns: Number(r.turns),
      })),
    };
  });
}
