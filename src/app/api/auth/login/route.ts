import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { homeFor } from '@/lib/home';
import { clientIp, hit, limits, rateLimited, refund, WINDOW_15_MIN } from '@/lib/rate-limit';
import { handle, json, readJson, redactError, sessionCookie } from '@/lib/http';
import { studentStatus } from '@/modules/enrollment';
import { login, normalizeUsername } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ username: z.string().max(200), password: z.string().max(256) });

async function giveBack(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await refund(key, WINDOW_15_MIN);
    } catch (err) {
      console.error('login rate-limit refund failed', redactError(err));
    }
  }
}

export const POST = handle(async (req: Request) => {
  const { username, password } = await readJson(req, Body);
  const ipKey = `login:ip:${clientIp(req)}`;
  const userKey = `login:user:${normalizeUsername(username)}`;

  // Reserve both budgets up front (atomic) so a concurrent burst cannot overshoot and run argon2 past the limit.
  const reserved: string[] = [];
  try {
    const ip = await hit(ipKey, limits.loginPerIp(), WINDOW_15_MIN);
    if (!ip.allowed) throw rateLimited(ip.retryAfterMs);
    reserved.push(ipKey);
    const user = await hit(userKey, limits.loginPerUser(), WINDOW_15_MIN);
    if (!user.allowed) {
      await giveBack(reserved);
      throw rateLimited(user.retryAfterMs);
    }
    reserved.push(userKey);
  } catch (err) {
    if (reserved.length > 0 && !(err instanceof DomainError && err.code === 'RATE_LIMITED')) await giveBack(reserved);
    throw err;
  }

  try {
    const { token, actor } = await login(username, password);
    const status = actor.roles.includes('student') ? (await studentStatus(actor)).status : undefined;
    await giveBack(reserved); // only failures count
    return json(
      { roles: actor.roles, isPlatformAdmin: actor.isPlatformAdmin, home: homeFor(actor, status) },
      { headers: { 'set-cookie': sessionCookie(token) } },
    );
  } catch (err) {
    if (!(err instanceof DomainError && err.code === 'INVALID_CREDENTIALS')) {
      await giveBack(reserved);
    }
    throw err;
  }
});
