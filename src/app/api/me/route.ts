import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { HttpError, handle, json, requireActor } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const [u] = await withPlatform((tx) => tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)));
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
  return json({ name: u.name, roles: actor.roles, isPlatformAdmin: actor.isPlatformAdmin });
});
