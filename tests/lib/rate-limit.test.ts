import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { clientIp, enforce, hit, purgeRateLimits, refund } from '@/lib/rate-limit';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);
afterAll(closeDb);

const MIN = 60_000;
const T0 = new Date('2026-01-01T00:00:00.000Z');

describe('hit', () => {
  it('allows up to the limit then blocks with a retry delay', async () => {
    for (let i = 0; i < 3; i++) expect((await hit('k', 3, 15 * MIN, T0)).allowed).toBe(true);
    const r = await hit('k', 3, 15 * MIN, new Date(T0.getTime() + 5 * MIN));
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(10 * MIN);
  });

  it('starts a fresh window at the boundary', async () => {
    for (let i = 0; i < 4; i++) await hit('k', 3, 15 * MIN, T0);
    expect((await hit('k', 3, 15 * MIN, new Date(T0.getTime() + 15 * MIN - 1))).allowed).toBe(false);
    expect((await hit('k', 3, 15 * MIN, new Date(T0.getTime() + 15 * MIN))).allowed).toBe(true);
  });

  it('keeps keys independent', async () => {
    for (let i = 0; i < 4; i++) await hit('a', 3, MIN, T0);
    expect((await hit('b', 3, MIN, T0)).allowed).toBe(true);
  });

  it('is atomic under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => hit('c', 5, MIN, T0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const [row] = await withPlatform((tx) => tx.select().from(rateLimits).where(eq(rateLimits.key, 'c')));
    expect(row.count).toBe(20);
  });
});

describe('refund / enforce / purge / clientIp', () => {
  it('refund gives one attempt back and never goes negative', async () => {
    await hit('r', 1, MIN, T0);
    await refund('r', MIN, T0);
    expect((await hit('r', 1, MIN, T0)).allowed).toBe(true);
    await refund('r', MIN, T0);
    await refund('r', MIN, T0);
    const [row] = await withPlatform((tx) => tx.select().from(rateLimits).where(eq(rateLimits.key, 'r')));
    expect(row.count).toBe(0);
  });

  it('enforce throws RATE_LIMITED with retryAfterMs once over the limit', async () => {
    await enforce('e', 1, MIN, T0);
    const err = await enforce('e', 1, MIN, T0).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.details.retryAfterMs).toBe(MIN);
  });

  it('purgeRateLimits deletes only windows older than the cutoff', async () => {
    await hit('old', 5, MIN, new Date(T0.getTime() - 3 * 86_400_000));
    await hit('new', 5, MIN, T0);
    expect(await purgeRateLimits(new Date(T0.getTime() - 86_400_000))).toBe(1);
    const rows = await withPlatform((tx) => tx.select().from(rateLimits));
    expect(rows.map((r) => r.key)).toEqual(['new']);
  });

  it('clientIp uses the first x-forwarded-for hop, else unknown', () => {
    const r = (h: Record<string, string>) => new Request('http://x', { headers: h });
    expect(clientIp(r({ 'x-forwarded-for': ' 1.2.3.4 , 9.9.9.9' }))).toBe('1.2.3.4');
    expect(clientIp(r({}))).toBe('unknown');
  });
});
