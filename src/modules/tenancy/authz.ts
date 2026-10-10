import { withPlatform, withTenant, type Tx } from '@/db/client';
import { DomainError } from '@/lib/errors';
import type { Actor } from './actor';

/** Runs `fn` in the actor's scope: platform admins see everything, others only their school (RLS). */
export async function runAs<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (actor.isPlatformAdmin) return withPlatform(fn);
  if (!actor.schoolId) throw new DomainError('FORBIDDEN', 'No school context');
  return withTenant(actor.schoolId, fn);
}

export function requirePlatform(actor: Actor): void {
  if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN', 'Platform admin only');
}

export function canManageSchool(actor: Actor, schoolId: string): boolean {
  return actor.isPlatformAdmin || (actor.schoolId === schoolId && actor.roles.includes('school_admin'));
}

export function canManageBranch(actor: Actor, schoolId: string, branchId: string): boolean {
  if (canManageSchool(actor, schoolId)) return true;
  return actor.schoolId === schoolId && actor.roles.includes('branch_admin') && actor.branchId === branchId;
}

export function assert(cond: boolean, message = 'Forbidden'): asserts cond {
  if (!cond) throw new DomainError('FORBIDDEN', message);
}
