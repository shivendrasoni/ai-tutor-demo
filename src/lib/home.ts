import type { Actor, StudentStatus } from '@/modules/tenancy';

/** Where an actor lands after login and when they open a page meant for someone else. */
export function homeFor(actor: Actor, studentStatus?: StudentStatus): string {
  if (actor.isPlatformAdmin) return '/platform';
  if (actor.roles.includes('school_admin') || actor.roles.includes('branch_admin')) return '/school';
  if (actor.roles.includes('teacher')) return '/teacher';
  if (actor.roles.includes('student')) return studentStatus === 'active' ? '/learn' : '/status';
  return '/login';
}
