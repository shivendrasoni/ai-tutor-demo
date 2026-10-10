import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant, type Tx } from '@/db/client';
import { memberships, plans, sections, studentProfiles, subscriptions, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { assertUsernameFree, validateCredentials, withUsernameTakenHandling } from '@/modules/tenancy/auth/credentials';
import { hashPassword } from '@/modules/tenancy/auth/passwords';
import { normalizeUsername, suggestUsernames, assertValidUsername } from '@/modules/tenancy/auth/usernames';
import { findBranchByCode } from '@/modules/tenancy/service';

export { validateCredentials };

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
  z.email().max(200).optional(),
);

const SignupSchema = z.object({
  code: z.string().trim().min(1).max(32),
  grade: z.number().int().min(5).max(12),
  sectionId: z.uuid().optional(),
  studentName: z.string().trim().min(1).max(200),
  parentName: z.string().trim().min(1).max(200),
  parentPhone: z.string().trim().min(1).max(32),
  parentEmail: optionalEmail,
  planId: z.uuid(),
  username: z.string(),
  password: z.string(),
});

export type SignupInput = {
  code: string;
  grade: number;
  sectionId?: string;
  studentName: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  planId: string;
  username: string;
  password: string;
};

/** The section must exist (RLS scopes it to the school), belong to the branch and match the grade; else VALIDATION. */
export async function assertSectionInBranch(tx: Tx, sectionId: string, branchId: string, grade: number): Promise<void> {
  const [s] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.branchId, branchId), eq(sections.grade, grade)))
    .limit(1);
  if (!s) throw new DomainError('VALIDATION', 'Section does not belong to this branch and grade');
}

export async function checkUsername(
  raw: string,
): Promise<{ username: string; available: boolean; suggestions: string[] }> {
  const username = normalizeUsername(raw);
  assertValidUsername(username);
  return withPlatform(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!taken) return { username, available: true, suggestions: [] };
    return { username, available: false, suggestions: await suggestUsernames(tx, username, 3) };
  });
}

/** Public self-signup with a branch code: creates a pending_payment student with a pending subscription. */
export async function signupWithCode(input: SignupInput): Promise<{ studentUserId: string; subscriptionId: string }> {
  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid signup details', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = parsed.data;
  const username = validateCredentials(data.username, data.password);

  const branch = await findBranchByCode(data.code);
  if (!branch) throw new DomainError('INVALID_CODE', 'This branch code is not valid');
  if (!branch.enabled) throw new DomainError('CODE_DISABLED', 'Signups with this branch code are turned off');

  const passwordHash = await hashPassword(data.password);

  return withUsernameTakenHandling(username, () =>
    withTenant(branch.schoolId, async (tx) => {
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, data.planId), eq(plans.active, true)))
        .limit(1);
      if (!plan) throw new DomainError('VALIDATION', 'Unknown or inactive plan');
      if (data.sectionId) await assertSectionInBranch(tx, data.sectionId, branch.branchId, data.grade);
      await assertUsernameFree(tx, username);

      const [user] = await tx
        .insert(users)
        .values({ username, passwordHash, name: data.studentName })
        .returning({ id: users.id });
      await tx
        .insert(memberships)
        .values({ userId: user.id, schoolId: branch.schoolId, branchId: branch.branchId, role: 'student' });
      await tx.insert(studentProfiles).values({
        userId: user.id,
        schoolId: branch.schoolId,
        branchId: branch.branchId,
        grade: data.grade,
        sectionId: data.sectionId ?? null,
        parentName: data.parentName,
        parentPhone: data.parentPhone,
        parentEmail: data.parentEmail ?? null,
        status: 'pending_payment',
      });
      const [sub] = await tx
        .insert(subscriptions)
        .values({ schoolId: branch.schoolId, studentId: user.id, planId: plan.id, status: 'pending' })
        .returning({ id: subscriptions.id });
      return { studentUserId: user.id, subscriptionId: sub.id };
    }),
  );
}
