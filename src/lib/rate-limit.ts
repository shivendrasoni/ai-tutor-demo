import { and, eq, lt, sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { rateLimits } from '@/db/schema';
import { DomainError } from '@/lib/errors';

const MINUTE = 60_000;
export const WINDOW_15_MIN = 15 * MINUTE;
export const WINDOW_1_HOUR = 60 * MINUTE;

const windowStartOf = (now: Date, windowMs: number) => new Date(Math.floor(now.getTime() / windowMs) * windowMs);

/**
 * Fixed-window counter. Atomically increments the (key, window) counter and reports whether the call is
 * within `limit`. Blocked calls still count (the window is fixed, so this cannot extend a lockout).
 */
export async function hit(
  key: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const windowStart = windowStartOf(now, windowMs);
  const [row] = await withPlatform((tx) =>
    tx
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count }),
  );
  return { allowed: row.count <= limit, retryAfterMs: Math.max(0, windowStart.getTime() + windowMs - now.getTime()) };
}

/** Gives one attempt back in the current window (never below zero). */
export async function refund(key: string, windowMs: number, now: Date = new Date()): Promise<void> {
  await withPlatform((tx) =>
    tx
      .update(rateLimits)
      .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
      .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStartOf(now, windowMs)))),
  );
}

/** `hit` that throws RATE_LIMITED (429, with retry-after) when over the limit. */
export async function enforce(key: string, limit: number, windowMs: number, now?: Date): Promise<void> {
  const r = await hit(key, limit, windowMs, now);
  if (!r.allowed) throw rateLimited(r.retryAfterMs);
}

export const rateLimited = (retryAfterMs: number) =>
  new DomainError('RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfterMs });

/** Deletes counter windows that started before `cutoff`. Returns the number of rows removed. */
export async function purgeRateLimits(cutoff: Date): Promise<number> {
  const rows = await withPlatform((tx) =>
    tx.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff)).returning({ key: rateLimits.key }),
  );
  return rows.length;
}

/** Client IP: first hop of x-forwarded-for, else 'unknown'. */
export function clientIp(req: Request): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Per-route limits. Defaults apply unless overridden by env (the e2e suite raises them because every spec
 * logs in from one IP): RATE_LIMIT_LOGIN_USER, RATE_LIMIT_LOGIN_IP, RATE_LIMIT_JOIN_LOOKUP, RATE_LIMIT_JOIN_SUBMIT.
 */
export const limits = {
  loginPerUser: () => envInt('RATE_LIMIT_LOGIN_USER', 10), // failed attempts / 15 min
  loginPerIp: () => envInt('RATE_LIMIT_LOGIN_IP', 50), // failed attempts / 15 min
  joinLookupPerIp: () => envInt('RATE_LIMIT_JOIN_LOOKUP', 60), // / 15 min
  joinSubmitPerIp: () => envInt('RATE_LIMIT_JOIN_SUBMIT', 20), // / hour
};
