import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { studentStatus } from '@/modules/enrollment';
import { resolveActor, type Actor, type Role, type StudentStatus } from '@/modules/tenancy';
import { homeFor } from './home';
import { SESSION_COOKIE } from './http';

export type PageRole = Role | 'platform';
export type PageAccessOpts = { allowInactiveStudent?: boolean };

/** Pure access decision: ok, or the URL to redirect to. */
export function checkPageAccess(
  actor: Actor | null,
  status: StudentStatus | undefined,
  roles: PageRole[],
  opts: PageAccessOpts = {},
): { ok: true } | { redirect: string } {
  if (!actor) return { redirect: '/login' };
  const matches =
    (actor.isPlatformAdmin && roles.includes('platform')) || actor.roles.some((r) => roles.includes(r));
  if (!matches) return { redirect: homeFor(actor, status) };
  if (!actor.isPlatformAdmin && actor.roles.includes('student') && status !== 'active' && !opts.allowInactiveStudent) {
    return { redirect: '/status' };
  }
  return { ok: true };
}

/** The signed-in actor for a server component, or a redirect to /login or their own home. */
export async function requirePageActor(roles: PageRole[], opts: PageAccessOpts = {}): Promise<Actor> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await resolveActor(token);
  let status: StudentStatus | undefined;
  if (actor && !actor.isPlatformAdmin && actor.roles.includes('student')) {
    status = await studentStatus(actor).then((s) => s.status, () => undefined);
  }
  const r = checkPageAccess(actor, status, roles, opts);
  if ('redirect' in r) redirect(r.redirect);
  return actor!;
}
