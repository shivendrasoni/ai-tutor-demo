import { clearSessionCookie, handle, json, sessionToken } from '@/lib/http';
import { revokeSession } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const token = sessionToken(req);
  if (token) await revokeSession(token);
  return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } });
});
