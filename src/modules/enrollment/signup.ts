import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withPlatform, withTenant, type Tx } from '@/db/client';
import { memberships, plans, sections, studentProfiles, subscriptions, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import {
  assertValidUsername,
  findBranchByCode,
  hashPassword,
  isUsernameTaken,
  normalizeUsername,
  suggestUsernames,
  validateCredentials,
} from '@/modules/tenancy';
import { assertUsernameFree, withUsernameTakenHandling } from '@/modules/tenancy/auth/credentials';

export { validateCredentials };

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
  z.email().max(200).optional(),
);

export const SignupSchema = z.object({
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

/** Throws VALIDATION unless the section exists (visible in this tx), is in `branchId`, and matches `grade`. */
export async function assertSectionInBranch(tx: Tx, sectionId: string, branchId: string, grade: number): Promise<void> {
  const parsed = z.uuid().safeParse(sectionId);
  const [row] = parsed.success
    ? await tx
        .select({ branchId: sections.branchId, grade: sections.grade })
        .from(sections)
        .where(eq(sections.id, sectionId))
        .limit(1)
    : [];
  if (!row || row.branchId !== branchId || row.grade !== grade) {
    throw new DomainError('VALIDATION', 'Section does not belong to this branch and grade', { field: 'sectionId' });
  }
}

export async function checkUsername(
  raw: string,
): Promise<{ username: string; available: boolean; suggestions: string[] }> {
  const username = normalizeUsername(typeof raw === 'string' ? raw : '');
  assertValidUsername(username);
  return withPlatform(async (tx) => {
    const taken = await isUsernameTaken(tx, username);
    return { username, available: !taken, suggestions: taken ? await suggestUsernames(tx, username, 3) : [] };
  });
}

export async function signupWithCode(input: SignupInput): Promise<{ studentUserId: string; subscriptionId: string }> {
  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'Invalid signup details', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = parsed.data;

  const branch = await findBranchByCode(data.code);
  if (!branch) throw new DomainError('INVALID_CODE', 'Unknown signup code');
  if (!branch.enabled) throw new DomainError('CODE_DISABLED', 'This signup code is disabled');

  const username = validateCredentials(data.username, data.password);
  const passwordHash = await hashPassword(data.password);

  return withUsernameTakenHandling(username, () =>
    withTenant(branch.schoolId, async (tx) => {
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, data.planId), eq(plans.active, true)))
        .limit(1);
      if (!plan) throw new DomainError('VALIDATION', 'Plan is not available', { field: 'planId' });
      if (data.sectionId) await assertSectionInBranch(tx, data.sectionId, branch.branchId, data.grade);

      await assertUsernameFree(tx, username);
      const [user] = await tx
        .insert(users)
        .values({ username, passwordHash, name: data.studentName })
        .returning({ id: users.id });
      await tx.insert(memberships).values({
        userId: user.id, schoolId: branch.schoolId, branchId: branch.branchId, role: 'student',
      });
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
