import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, sessionCookie } from '@/lib/http';
import { clientIp, hit, limits, peek, rateLimited, refund, WINDOW_15_MIN } from '@/lib/rate-limit';
import { homeFor } from '@/lib/home';
import { studentStatus } from '@/modules/enrollment';
import { login, normalizeUsername } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});

export const POST = handle(async (req: Request) => {
  const { username, password } = await readJson(req, Body);
  // Failed attempts are throttled per client IP and per username. The IP counter only ever counts failures
  // (checked before verifying, incremented only on invalid credentials, never refunded), so successful logins
  // can neither consume nor reset it and a school behind one NAT is not locked out by normal use. The username
  // counter is taken up front and refunded when the password check is passed. A blocked request never reaches
  // the (expensive) password verification.
  const ipKey = `login:ip:${clientIp(req)}`;
  const userKey = `login:user:${normalizeUsername(username)}`;
  const ip = await peek(ipKey, limits.loginPerIp(), WINDOW_15_MIN);
  if (!ip.allowed) throw rateLimited(ip.retryAfterMs);
  const user = await hit(userKey, limits.loginPerUser(), WINDOW_15_MIN);
  if (!user.allowed) throw rateLimited(user.retryAfterMs);
  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(username, password);
  } catch (err) {
    // Only a wrong username/password counts as a failed attempt.
    if (err instanceof DomainError && err.code === 'INVALID_CREDENTIALS') await hit(ipKey, limits.loginPerIp(), WINDOW_15_MIN);
    else await refund(userKey, WINDOW_15_MIN);
    throw err;
  }
  await refund(userKey, WINDOW_15_MIN);
  const { token, actor } = result;
  const isStudent = !actor.isPlatformAdmin && actor.roles.includes('student');
  const home = homeFor(actor, isStudent ? (await studentStatus(actor)).status : undefined);
  return json({ roles: actor.roles, isPlatformAdmin: actor.isPlatformAdmin, home }, { headers: { 'set-cookie': sessionCookie(token) } });
});
