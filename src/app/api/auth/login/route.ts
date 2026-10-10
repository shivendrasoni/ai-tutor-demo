import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, sessionCookie } from '@/lib/http';
import { clientIp, hit, limits, rateLimited, refund, WINDOW_15_MIN } from '@/lib/rate-limit';
import { homeFor } from '@/lib/home';
import { studentStatus } from '@/modules/enrollment';
import { login, normalizeUsername } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});

/** Refunds reservations; a limiter DB error must not change the response (e.g. turn a 401 into a 500). */
async function giveBack(...keys: string[]): Promise<void> {
  try {
    await Promise.all(keys.map((k) => refund(k, WINDOW_15_MIN)));
  } catch (err) {
    console.error('login rate-limit refund failed', err);
  }
}

export const POST = handle(async (req: Request) => {
  const { username, password } = await readJson(req, Body);
  // Both counters are reserved atomically up front (so a concurrent burst cannot get past the limit and run
  // argon2), then the reservation is given back when the attempt did not fail on credentials. Net effect: the
  // per-IP key counts failed attempts only, so successful logins can neither consume nor reset it (a refund only
  // cancels its own hit) and a school behind one NAT is not locked out by normal use. A blocked request never
  // reaches the (expensive) password verification.
  const ipKey = `login:ip:${clientIp(req)}`;
  const userKey = `login:user:${normalizeUsername(username)}`;
  const ip = await hit(ipKey, limits.loginPerIp(), WINDOW_15_MIN);
  if (!ip.allowed) throw rateLimited(ip.retryAfterMs);
  const user = await hit(userKey, limits.loginPerUser(), WINDOW_15_MIN);
  if (!user.allowed) {
    await giveBack(ipKey);
    throw rateLimited(user.retryAfterMs);
  }
  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(username, password);
  } catch (err) {
    // Only a wrong username/password counts as a failed attempt (keeps both reservations).
    if (!(err instanceof DomainError && err.code === 'INVALID_CREDENTIALS')) await giveBack(ipKey, userKey);
    throw err;
  }
  await giveBack(ipKey, userKey);
  const { token, actor } = result;
  const isStudent = !actor.isPlatformAdmin && actor.roles.includes('student');
  const home = homeFor(actor, isStudent ? (await studentStatus(actor)).status : undefined);
  return json({ roles: actor.roles, isPlatformAdmin: actor.isPlatformAdmin, home }, { headers: { 'set-cookie': sessionCookie(token) } });
});
