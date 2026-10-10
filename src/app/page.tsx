import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/home';
import { SESSION_COOKIE } from '@/lib/http';
import { studentStatus } from '@/modules/enrollment';
import { resolveActor } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const actor = await resolveActor((await cookies()).get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');
  const isStudent = !actor.isPlatformAdmin && actor.roles.includes('student');
  const status = isStudent ? await studentStatus(actor).then((s) => s.status, () => undefined) : undefined;
  redirect(homeFor(actor, status));
}
