import { and, eq, lt, sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { DomainError } from '@/lib/errors';

export const WINDOW_15_MIN = 15 * 60_000;
export const WINDOW_1_HOUR = 60 * 60_000;

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Env-aware limits, read at call time. */
export const limits = {
  loginPerUser: () => envInt('RATE_LIMIT_LOGIN_USER', 10),
  loginPerIp: () => envInt('RATE_LIMIT_LOGIN_IP', 100),
  joinLookupPerIp: () => envInt('RATE_LIMIT_JOIN_LOOKUP', 60),
  joinSubmitPerIp: () => envInt('RATE_LIMIT_JOIN_SUBMIT', 20),
};

const windowStart = (windowMs: number, now: Date) => new Date(Math.floor(now.getTime() / windowMs) * windowMs);

/** Fixed-window counter: atomically counts this attempt and says whether it is within `limit`. */
export async function hit(
  key: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const start = windowStart(windowMs, now);
  const [row] = await withPlatform((tx) =>
    tx
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count }),
  );
  const allowed = row.count <= limit;
  return { allowed, retryAfterMs: allowed ? 0 : start.getTime() + windowMs - now.getTime() };
}

/** Gives one attempt back in the current window (never below zero). */
export async function refund(key: string, windowMs: number, now: Date = new Date()): Promise<void> {
  const start = windowStart(windowMs, now);
  await withPlatform((tx) =>
    tx
      .update(rateLimits)
      .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
      .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, start))),
  );
}

export const rateLimited = (retryAfterMs: number): DomainError =>
  new DomainError('RATE_LIMITED', 'Too many attempts. Please try again later.', { retryAfterMs });

export async function enforce(key: string, limit: number, windowMs: number, now: Date = new Date()): Promise<void> {
  const r = await hit(key, limit, windowMs, now);
  if (!r.allowed) throw rateLimited(r.retryAfterMs);
}

/** Deletes windows that started before `cutoff`; returns the number removed. */
export async function purgeRateLimits(cutoff: Date): Promise<number> {
  const rows = await withPlatform((tx) =>
    tx.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff)).returning({ key: rateLimits.key }),
  );
  return rows.length;
}

let warned = false;
export const resetClientIpWarning = (): void => {
  warned = false;
};

function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** The client IP: the Nth `x-forwarded-for` entry from the right (N = TRUSTED_PROXY_HOPS), else 'unknown'. */
export function clientIp(req: Request): string {
  const hops = trustedHops();
  if (hops === 0) return 'unknown';
  const header = req.headers.get('x-forwarded-for');
  const parts = header?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (parts.length === 0) {
    if (!warned) {
      warned = true;
      console.warn(
        'rate limit: TRUSTED_PROXY_HOPS > 0 but a request had no x-forwarded-for; such clients share one "unknown" bucket',
      );
    }
    return 'unknown';
  }
  return parts[Math.max(parts.length - hops, 0)];
}
