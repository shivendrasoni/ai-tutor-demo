import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant } from '@/db/client';
import { branches, invites, memberships, plans, schools, studentProfiles, subscriptions, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { isUuid } from '@/lib/uuid';
import type { Actor } from '@/modules/tenancy/actor';
import { assertUsernameFree, validateCredentials, withUsernameTakenHandling } from '@/modules/tenancy/auth/credentials';
import { hashPassword } from '@/modules/tenancy/auth/passwords';
import { generateToken, hashToken } from '@/modules/tenancy/auth/sessions';
import { canManageBranch, runAs } from '@/modules/tenancy/authz';
import { assertSectionInBranch } from './signup';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const MAX_TOKEN_LENGTH = 200;

const invalidInvite = () => new DomainError('INVITE_INVALID', 'This invite is invalid or has expired');

function inviteUrlFor(token: string): string {
  const base = process.env.APP_URL;
  if (!base) throw new Error('APP_URL is not set');
  return `${base.replace(/\/+$/, '')}/invite/${token}`;
}

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
  z.email().max(200).optional(),
);

const ManualAddSchema = z.object({
  grade: z.number().int().min(5).max(12),
  sectionId: z.uuid().optional(),
  studentName: z.string().trim().min(1).max(200),
  parentName: z.string().trim().min(1).max(200),
  parentPhone: z.string().trim().min(1).max(32),
  parentEmail: optionalEmail,
});

export type ManualAddInput = {
  branchId: string;
  grade: number;
  sectionId?: string;
  studentName: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
};

/** A school/branch admin adds a student on behalf of a parent: a credential-less pending_payment student plus a 14-day invite. */
export async function manualAddStudent(
  actor: Actor,
  input: ManualAddInput,
): Promise<{ studentUserId: string; inviteToken: string; inviteUrl: string }> {
  const notFound = () => new DomainError('NOT_FOUND', 'Branch not found');
  if (!isUuid(input?.branchId)) throw notFound();
  const parsed = ManualAddSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid student details', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = parsed.data;
  inviteUrlFor('x'); // fail before any write when APP_URL is missing

  const token = generateToken();
  const studentUserId = await runAs(actor, async (tx) => {
    const [branch] = await tx
      .select({ id: branches.id, schoolId: branches.schoolId })
      .from(branches)
      .where(eq(branches.id, input.branchId));
    if (!branch) throw notFound();
    if (!canManageBranch(actor, branch.schoolId, branch.id)) throw new DomainError('FORBIDDEN');
    if (data.sectionId) await assertSectionInBranch(tx, data.sectionId, branch.id, data.grade);

    const [user] = await tx.insert(users).values({ name: data.studentName }).returning({ id: users.id });
    await tx
      .insert(memberships)
      .values({ userId: user.id, schoolId: branch.schoolId, branchId: branch.id, role: 'student' });
    await tx.insert(studentProfiles).values({
      userId: user.id,
      schoolId: branch.schoolId,
      branchId: branch.id,
      grade: data.grade,
      sectionId: data.sectionId ?? null,
      parentName: data.parentName,
      parentPhone: data.parentPhone,
      parentEmail: data.parentEmail ?? null,
      status: 'pending_payment',
    });
    await tx.insert(invites).values({
      schoolId: branch.schoolId,
      studentUserId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    return user.id;
  });
  return { studentUserId, inviteToken: token, inviteUrl: inviteUrlFor(token) };
}

/** Public preview of an invite; null when unknown, expired, used, or the student was removed. */
export async function getInvite(
  token: string,
): Promise<{ studentName: string; schoolName: string; branchName: string; grade: number } | null> {
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) return null;
  const [row] = await withPlatform((tx) =>
    tx
      .select({
        studentName: users.name,
        schoolName: schools.name,
        branchName: branches.name,
        grade: studentProfiles.grade,
      })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.studentUserId))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, invites.studentUserId))
      .innerJoin(schools, eq(schools.id, invites.schoolId))
      .innerJoin(branches, eq(branches.id, studentProfiles.branchId))
      .where(
        and(
          eq(invites.tokenHash, hashToken(token)),
          isNull(invites.usedAt),
          gt(invites.expiresAt, new Date()),
          eq(studentProfiles.status, 'pending_payment'),
          isNull(users.passwordHash),
        ),
      ),
  );
  return row ?? null;
}

/** Sets the student's credentials, creates the pending subscription and consumes the invite, atomically. */
export async function completeInvite(input: {
  token: string;
  planId: string;
  username: string;
  password: string;
}): Promise<{ studentUserId: string; subscriptionId: string }> {
  const { token, planId } = input;
  const username = validateCredentials(input.username, input.password);
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) throw invalidInvite();
  const tokenHash = hashToken(token);

  const [found] = await withPlatform((tx) =>
    tx.select({ schoolId: invites.schoolId }).from(invites).where(eq(invites.tokenHash, tokenHash)),
  );
  if (!found) throw invalidInvite();

  const passwordHash = await hashPassword(input.password);

  return withUsernameTakenHandling(username, () =>
    withTenant(found.schoolId, async (tx) => {
      // Single-use: the conditional update takes the row lock, so a concurrent completion waits
      // and then matches zero rows. Any later failure rolls this claim back with the transaction.
      const [claimed] = await tx
        .update(invites)
        .set({ usedAt: new Date() })
        .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
        .returning({ studentUserId: invites.studentUserId });
      if (!claimed) throw invalidInvite();

      const [profile] = await tx
        .select({ status: studentProfiles.status })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, claimed.studentUserId));
      if (!profile || profile.status !== 'pending_payment') throw invalidInvite();

      if (!isUuid(planId)) throw new DomainError('VALIDATION', 'Unknown or inactive plan');
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.active, true)));
      if (!plan) throw new DomainError('VALIDATION', 'Unknown or inactive plan');

      await assertUsernameFree(tx, username);
      const updated = await tx
        .update(users)
        .set({ username, passwordHash })
        .where(and(eq(users.id, claimed.studentUserId), isNull(users.passwordHash)))
        .returning({ id: users.id });
      if (updated.length === 0) throw invalidInvite();

      const [sub] = await tx
        .insert(subscriptions)
        .values({ schoolId: found.schoolId, studentId: claimed.studentUserId, planId: plan.id, status: 'pending' })
        .returning({ id: subscriptions.id });
      return { studentUserId: claimed.studentUserId, subscriptionId: sub.id };
    }),
  );
}

/** A fresh 14-day invite for a student who has not signed up yet; every older unused invite is expired. */
export async function reissueInvite(actor: Actor, studentUserId: string): Promise<{ inviteUrl: string }> {
  const notFound = () => new DomainError('NOT_FOUND', 'Student not found');
  if (!isUuid(studentUserId)) throw notFound();
  inviteUrlFor('x');
  const token = generateToken();
  await runAs(actor, async (tx) => {
    const [row] = await tx
      .select({
        schoolId: studentProfiles.schoolId,
        branchId: studentProfiles.branchId,
        status: studentProfiles.status,
        username: users.username,
        passwordHash: users.passwordHash,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .where(eq(studentProfiles.userId, studentUserId));
    if (!row) throw notFound();
    if (!canManageBranch(actor, row.schoolId, row.branchId)) throw new DomainError('FORBIDDEN');

    // Serialize concurrent reissues for the same student so exactly one live invite remains.
    await tx.execute(sql`select id from users where id = ${studentUserId} for update`);
    const [fresh] = await tx
      .select({ status: studentProfiles.status, username: users.username, passwordHash: users.passwordHash })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .where(and(eq(studentProfiles.userId, studentUserId), ne(studentProfiles.status, 'removed')));
    if (!fresh || fresh.status !== 'pending_payment' || fresh.username !== null || fresh.passwordHash !== null) {
      throw new DomainError('VALIDATION', 'An invite can only be issued to a pending student who has not signed up', {
        reason: 'not_reissuable',
      });
    }

    const now = new Date();
    await tx
      .update(invites)
      .set({ expiresAt: now })
      .where(and(eq(invites.studentUserId, studentUserId), isNull(invites.usedAt), gt(invites.expiresAt, now)));
    await tx.insert(invites).values({
      schoolId: row.schoolId,
      studentUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });
  });
  return { inviteUrl: inviteUrlFor(token) };
}
