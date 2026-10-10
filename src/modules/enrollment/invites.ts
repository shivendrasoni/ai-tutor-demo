import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant } from '@/db/client';
import {
  branches, invites, memberships, plans, schools, studentProfiles, subscriptions, users,
} from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { assertUsernameFree, withUsernameTakenHandling } from '@/modules/tenancy/auth/credentials';
import { hashPassword } from '@/modules/tenancy/auth/passwords';
import { generateToken, hashToken } from '@/modules/tenancy/auth/sessions';
import { assert, canManageBranch, runAs } from '@/modules/tenancy/authz';
import { assertSectionInBranch, validateCredentials } from './signup';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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

const invalidInvite = () => new DomainError('INVITE_INVALID', 'This invite is invalid or has expired');
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error('APP_URL is not set');
  return url.replace(/\/+$/, '');
}

export async function manualAddStudent(
  actor: Actor,
  input: {
    branchId: string; grade: number; sectionId?: string; studentName: string;
    parentName: string; parentPhone: string; parentEmail?: string;
  },
): Promise<{ studentUserId: string; inviteToken: string; inviteUrl: string }> {
  const base = appUrl();
  const token = generateToken();
  const studentUserId = await runAs(actor, async (tx) => {
    if (!isUuid(input.branchId)) throw new DomainError('NOT_FOUND', 'Branch not found');
    const [branch] = await tx.select().from(branches).where(eq(branches.id, input.branchId)).limit(1);
    if (!branch) throw new DomainError('NOT_FOUND', 'Branch not found');
    assert(canManageBranch(actor, branch.schoolId, branch.id));

    const parsed = ManualAddSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError('VALIDATION', 'Invalid student details', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data;
    if (data.sectionId) await assertSectionInBranch(tx, data.sectionId, branch.id, data.grade);

    const [user] = await tx.insert(users).values({ name: data.studentName }).returning({ id: users.id });
    await tx.insert(memberships).values({
      userId: user.id, schoolId: branch.schoolId, branchId: branch.id, role: 'student',
    });
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
  return { studentUserId, inviteToken: token, inviteUrl: `${base}/invite/${token}` };
}

/**
 * Issues a new invite link for a student who was added manually but has not signed up yet (no username),
 * e.g. because the first link expired or was lost. Older unused invites are expired. The caller needs
 * `canManageBranch` on the student's branch.
 */
export async function reissueInvite(actor: Actor, studentUserId: string): Promise<{ inviteUrl: string }> {
  const base = appUrl();
  const notFound = () => new DomainError('NOT_FOUND', 'Student not found');
  if (!isUuid(studentUserId)) throw notFound();
  const token = generateToken();
  await runAs(actor, async (tx) => {
    const [row] = await tx
      .select({
        schoolId: studentProfiles.schoolId,
        branchId: studentProfiles.branchId,
        status: studentProfiles.status,
        username: users.username,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(users.id, studentProfiles.userId))
      .where(eq(studentProfiles.userId, studentUserId))
      .limit(1)
      .for('update', { of: studentProfiles });
    if (!row) throw notFound();
    assert(canManageBranch(actor, row.schoolId, row.branchId));
    if (row.status !== 'pending_payment' || row.username !== null) {
      throw new DomainError('VALIDATION', 'A new invite can only be issued to a student who has not signed up yet', {
        reason: 'not_reissuable',
      });
    }
    const now = new Date();
    await tx
      .update(invites)
      .set({ expiresAt: now })
      .where(and(eq(invites.studentUserId, studentUserId), isNull(invites.usedAt)));
    await tx.insert(invites).values({
      schoolId: row.schoolId,
      studentUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });
  });
  return { inviteUrl: `${base}/invite/${token}` };
}

export async function getInvite(
  token: string,
): Promise<{ studentName: string; schoolName: string; branchName: string; grade: number } | null> {
  const row = await withPlatform(async (tx) => {
    if (typeof token !== 'string' || !token) return null;
    const [r] = await tx
      .select({
        usedAt: invites.usedAt,
        expiresAt: invites.expiresAt,
        status: studentProfiles.status,
        studentName: users.name,
        schoolName: schools.name,
        branchName: branches.name,
        grade: studentProfiles.grade,
      })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.studentUserId))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, invites.studentUserId))
      .innerJoin(branches, eq(branches.id, studentProfiles.branchId))
      .innerJoin(schools, eq(schools.id, invites.schoolId))
      .where(eq(invites.tokenHash, hashToken(token)))
      .limit(1);
    return r ?? null;
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.status === 'removed') return null;
  return { studentName: row.studentName, schoolName: row.schoolName, branchName: row.branchName, grade: row.grade };
}

export async function completeInvite(input: {
  token: string; planId: string; username: string; password: string;
}): Promise<{ studentUserId: string; subscriptionId: string }> {
  const username = validateCredentials(input.username, input.password);
  if (typeof input.token !== 'string' || !input.token) throw invalidInvite();
  const tokenHash = hashToken(input.token);

  const [found] = await withPlatform((tx) =>
    tx.select({ schoolId: invites.schoolId }).from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1),
  );
  if (!found) throw invalidInvite();
  const passwordHash = await hashPassword(input.password);

  return withUsernameTakenHandling(username, () =>
    withTenant(found.schoolId, async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, tokenHash))
        .limit(1)
        .for('update');
      if (!invite || invite.usedAt || invite.expiresAt.getTime() <= Date.now()) throw invalidInvite();
      const [profile] = await tx
        .select({ status: studentProfiles.status })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, invite.studentUserId))
        .limit(1);
      if (!profile || profile.status === 'removed') throw invalidInvite();

      const [plan] = isUuid(input.planId)
        ? await tx
            .select({ id: plans.id })
            .from(plans)
            .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
            .limit(1)
        : [];
      if (!plan) throw new DomainError('VALIDATION', 'Plan is not available', { field: 'planId' });

      await assertUsernameFree(tx, username);
      await tx.update(users).set({ username, passwordHash }).where(eq(users.id, invite.studentUserId));
      const [sub] = await tx
        .insert(subscriptions)
        .values({ schoolId: invite.schoolId, studentId: invite.studentUserId, planId: plan.id, status: 'pending' })
        .returning({ id: subscriptions.id });
      await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, invite.id));
      return { studentUserId: invite.studentUserId, subscriptionId: sub.id };
    }),
  );
}
