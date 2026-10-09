import { withPlatform, withTenant, type Tx } from '@/db/client';
import { DomainError } from '@/lib/errors';
import type { Actor } from './actor';

export function runAs<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (actor.isPlatformAdmin) return withPlatform(fn);
  if (!actor.schoolId) return Promise.reject(new DomainError('FORBIDDEN', 'Actor has no school'));
  return withTenant(actor.schoolId, fn);
}

export function requirePlatform(actor: Actor): void {
  if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN', 'Platform admin required');
}

export function canManageSchool(actor: Actor, schoolId: string): boolean {
  if (actor.isPlatformAdmin) return true;
  return actor.schoolId === schoolId && actor.roles.includes('school_admin');
}

export function canManageBranch(actor: Actor, schoolId: string, branchId: string): boolean {
  if (canManageSchool(actor, schoolId)) return true;
  return (
    actor.schoolId === schoolId &&
    actor.branchId === branchId &&
    actor.roles.includes('branch_admin')
  );
}

export function assert(cond: boolean): asserts cond {
  if (!cond) throw new DomainError('FORBIDDEN');
}
