import { z } from 'zod';
import { handle, json, readJson, sessionCookie } from '@/lib/http';
import { login } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});

export const POST = handle(async (req: Request) => {
  const { username, password } = await readJson(req, Body);
  const { token, actor } = await login(username, password);
  return json({ roles: actor.roles }, { headers: { 'set-cookie': sessionCookie(token) } });
});
