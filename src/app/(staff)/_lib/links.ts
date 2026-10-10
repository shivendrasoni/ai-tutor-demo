import { homeFor } from '@/lib/home';
import type { Actor } from '@/modules/tenancy';

export type StaffLink = { href: string; label: string };

/** Header links: Home always; a user holding both admin and teacher roles also gets both dashboards. */
export function staffLinks(actor: Actor): StaffLink[] {
  const links: StaffLink[] = [{ href: homeFor(actor), label: 'Home' }];
  const admin = actor.roles.includes('school_admin') || actor.roles.includes('branch_admin');
  if (!actor.isPlatformAdmin && admin && actor.roles.includes('teacher')) {
    links.push({ href: '/school', label: 'School' }, { href: '/teacher', label: 'Teacher' });
  }
  return links;
}
