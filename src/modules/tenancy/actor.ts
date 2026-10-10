import { and, asc, eq, gt } from 'drizzle-orm';
import { withPlatform, type Tx } from '@/db/client';
import { memberships, sessions, studentProfiles, users } from '@/db/schema';
import { hashToken } from './auth/sessions';

export type Role = 'school_admin' | 'branch_admin' | 'teacher' | 'student';
export type StudentStatus = 'pending_payment' | 'active' | 'lapsed' | 'removed';
export type Actor = {
  userId: string;
  isPlatformAdmin: boolean;
  schoolId: string | null;
  branchId: string | null;
  roles: Role[];
};

/**
 * Builds an Actor for a user from users + their membership. Null if user is missing or a removed student.
 * Model rule: a (non-platform) user belongs to ONE school; nothing enforces it in the schema, so if a user
 * ever has several memberships the oldest one (created_at, then id) wins deterministically.
 */
export async function loadActor(tx: Tx, userId: string): Promise<Actor | null> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const [sp] = await tx.select({ status: studentProfiles.status }).from(studentProfiles).where(eq(studentProfiles.userId, userId));
  if (sp?.status === 'removed') return null;
  const [m] = await tx.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt), asc(memberships.id)).limit(1);
  return {
    userId,
    isPlatformAdmin: u.isPlatformAdmin,
    schoolId: m?.schoolId ?? null,
    branchId: m?.branchId ?? null,
    roles: m ? [m.role as Role] : [],
  };
}

export async function resolveActor(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  return withPlatform(async (tx) => {
    const [s] = await tx
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return s ? loadActor(tx, s.userId) : null;
  });
}
