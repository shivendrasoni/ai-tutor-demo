import { and, asc, eq, gt } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { memberships, sessions, studentProfiles, users } from '@/db/schema';
import { hashToken } from './auth/sessions';

export type Role = 'school_admin' | 'branch_admin' | 'teacher' | 'student';
export type StudentStatus = 'pending_payment' | 'active' | 'lapsed' | 'removed';

export interface Actor {
  userId: string;
  isPlatformAdmin: boolean;
  schoolId: string | null;
  branchId: string | null;
  roles: Role[];
}

/** Builds the actor for a user; with several memberships the oldest by (created_at, id) wins. Null if no such user or the user is a removed student. */
export async function loadActor(tx: Tx, userId: string): Promise<Actor | null> {
  const [user] = await tx
    .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  if (await isRemovedStudent(tx, userId)) return null;
  const [m] = await tx
    .select({ schoolId: memberships.schoolId, branchId: memberships.branchId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1);
  return {
    userId: user.id,
    isPlatformAdmin: user.isPlatformAdmin,
    schoolId: m?.schoolId ?? null,
    branchId: m?.branchId ?? null,
    roles: m ? [m.role as Role] : [],
  };
}

/** True when the user has a student profile whose status is `removed`. */
export async function isRemovedStudent(tx: Tx, userId: string): Promise<boolean> {
  const [p] = await tx
    .select({ status: studentProfiles.status })
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, userId))
    .limit(1);
  return p?.status === 'removed';
}

/**
 * Resolves a session token to an actor. Null for a missing, unknown or expired session and for a removed student.
 * Pending and lapsed students still resolve (they may log in and see the status screen); the lapse rule is
 * applied by the callers that gate content, not here.
 */
export async function resolveActor(token: string | undefined): Promise<Actor | null> {
  if (typeof token !== 'string' || token === '') return null;
  return withPlatform(async (tx) => {
    const [s] = await tx
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!s) return null;
    if (await isRemovedStudent(tx, s.userId)) return null;
    return loadActor(tx, s.userId);
  });
}
