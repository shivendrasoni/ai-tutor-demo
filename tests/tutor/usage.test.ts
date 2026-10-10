import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { withPlatform, withTenant } from '@/db/client';
import { isBudgetExhausted, recordUsage, todayTokens } from '@/modules/tutor/usage';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
const base = () => ({ schoolId: seed.a.schoolId, studentId: seed.a.studentId });
const rec = (tokens: number, now?: Date, cost: number | null = 0.01) =>
  withTenant(seed.a.schoolId, (tx) => recordUsage(tx, { ...base(), tokens, cost, now }));
const exhausted = (now?: Date) =>
  withTenant(seed.a.schoolId, (tx) => isBudgetExhausted(tx, seed.a.studentId, now));

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterEach(() => vi.unstubAllEnvs());

describe('usage', () => {
  it('recordUsage upserts atomically and concurrent calls sum', async () => {
    const t = new Date('2027-03-01T10:00:00Z');
    await Promise.all([1, 2, 3].map(() => rec(100, t)));
    expect(await withTenant(seed.a.schoolId, (tx) => todayTokens(tx, seed.a.studentId, t))).toBe(300);
  });

  it('budget boundary: limit-1 not exhausted, limit exhausted, next UTC day fresh', async () => {
    vi.stubEnv('STUDENT_DAILY_TOKEN_LIMIT', '1000');
    const t = new Date('2027-01-05T23:59:59Z');
    await rec(999, t);
    expect(await exhausted(t)).toBe(false);
    await rec(1, t);
    expect(await exhausted(t)).toBe(true);
    expect(await exhausted(new Date('2027-01-06T00:00:00Z'))).toBe(false);
  });

  it('null cost adds nothing to cost; todayTokens is 0 with no row', async () => {
    const t = new Date('2027-02-01T00:00:00Z');
    expect(await withTenant(seed.a.schoolId, (tx) => todayTokens(tx, seed.a.studentId, t))).toBe(0);
    await rec(10, t, 0.5);
    await rec(10, t, null);
    const rows = await withPlatform((tx) =>
      tx.execute(sql`select tokens, cost::float8 as cost from usage_daily where date = '2027-02-01'`),
    );
    expect(rows.rows[0]).toMatchObject({ tokens: 20, cost: 0.5 });
  });
});
