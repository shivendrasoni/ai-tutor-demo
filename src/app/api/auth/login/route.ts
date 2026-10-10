import { z } from 'zod';
import { handle, json, readJson, sessionCookie } from '@/lib/http';
import { homeFor } from '@/lib/home';
import { studentStatus } from '@/modules/enrollment';
import { login } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});

export const POST = handle(async (req: Request) => {
  const { username, password } = await readJson(req, Body);
  const { token, actor } = await login(username, password);
  const isStudent = !actor.isPlatformAdmin && actor.roles.includes('student');
  const home = homeFor(actor, isStudent ? (await studentStatus(actor)).status : undefined);
  return json({ roles: actor.roles, isPlatformAdmin: actor.isPlatformAdmin, home }, { headers: { 'set-cookie': sessionCookie(token) } });
});
