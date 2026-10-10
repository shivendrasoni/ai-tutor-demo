import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/http';
import { resolveActor, type Actor } from '@/modules/tenancy';

/** The signed-in actor for a server component; no session redirects to /login. */
export async function requireStaffPageActor(): Promise<Actor> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await resolveActor(token);
  if (!actor) redirect('/login');
  return actor;
}
