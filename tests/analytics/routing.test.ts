import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { routingStats } from '@/modules/analytics';
import { insertMessage, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
const now = new Date('2027-03-10T12:00:00Z');
const at = new Date('2027-03-10T09:00:00Z');
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const put = (decisions: object | null, o: { role?: 'user' | 'assistant'; createdAt?: Date } = {}) =>
  insertMessage({
    schoolId: w.a.schoolId, studentId: w.a.student.userId, role: o.role ?? 'assistant',
    createdAt: o.createdAt ?? at, decisions,
  });

async function seed10() {
  const jev = { deciderProvider: 'jev' };
  await put({ tier: 'advanced', ...jev, filterFallback: true });
  await put({ tier: 'advanced', ...jev });
  await put({ tier: 'advanced', ...jev });
  await put({ tier: 'standard', ...jev, filterFallback: true });
  await put({ tier: 'standard', ...jev, deciderError: true });
  await put({ tier: 'standard', ...jev });
  await put({ tier: 'standard', ...jev });
  await put({ tier: 'standard', deciderProvider: 'llm', deciderFellBack: true });
  await put({ tier: null, fixedReply: 'off_topic', ...jev });
  await put({ tier: null, fixedReply: 'unsafe', ...jev });
}

describe('routingStats', () => {
  it('computes every field exactly', async () => {
    await seed10();
    // advanced / non-null tiers = 3 / 8 (fixed replies have tier null and are turns, not tier denominator)
    const s = await routingStats(w.platform, { days: 7, now });
    expect(s).toMatchObject({ turns: 10, offTopicBlocks: 1, unsafeBlocks: 1, filterFallbacks: 2, deciderErrors: 1, deciderFallbacks: 1 });
    expect(s.advancedShare).toBeCloseTo(3 / 8);
  });

  it('null decisions, empty {} and partial decisions are tolerated (Review Focus 2)', async () => {
    await seed10();
    await put(null);
    await put({});
    await put({ tier: 'advanced' });
    await put({ tier: 'advanced' }, { role: 'user' });
    const s = await routingStats(w.platform, { days: 7, now });
    expect(s.turns).toBe(12);
    expect(s.advancedShare).toBeCloseTo(4 / 9);
    expect(s).toMatchObject({ offTopicBlocks: 1, unsafeBlocks: 1, filterFallbacks: 2, deciderErrors: 1, deciderFallbacks: 1 });
  });

  it('turns without any tier give advancedShare 0, never NaN', async () => {
    await put({});
    await put({ tier: null, fixedReply: 'unsafe' });
    expect(await routingStats(w.platform, { days: 7, now })).toMatchObject({ turns: 2, advancedShare: 0, unsafeBlocks: 1 });
  });

  it('no turns yields zeros and advancedShare 0, never NaN (Review Focus 1, 2)', async () => {
    await seed10();
    expect(await routingStats(w.platform, { days: 7, now: new Date('2030-01-01T00:00:00Z') })).toEqual({
      turns: 0, advancedShare: 0, offTopicBlocks: 0, unsafeBlocks: 0, filterFallbacks: 0, deciderErrors: 0, deciderFallbacks: 0,
    });
  });

  it('window boundary at UTC midnight (Review Focus 5)', async () => {
    await put({ tier: 'standard' }, { createdAt: new Date('2027-03-04T00:00:00.000Z') });
    await put({ tier: 'standard' }, { createdAt: new Date('2027-03-03T23:59:59.999Z') });
    expect((await routingStats(w.platform, { days: 7, now })).turns).toBe(1);
    expect((await routingStats(w.platform, { days: 30, now })).turns).toBe(2);
  });

  it('non-platform FORBIDDEN; days 14 -> VALIDATION', async () => {
    await expect(routingStats(w.a.schoolAdmin, { days: 7, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(routingStats(w.platform, { days: 14 as never, now })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
