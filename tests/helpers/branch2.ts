import { withPlatform } from '@/db/client';
import { branches, sections } from '@/db/schema';
import { createStaffUser } from '@/modules/tenancy';
import { generateBranchCode } from '@/modules/tenancy/codes';
import type { Seed } from './db';

export type BranchA2 = { branchId: string; sectionId: string; teacherId: string };

/** Adds a second branch to school A with one section (grade 8, "8-A2") and one teacher. */
export async function addBranchA2(seed: Seed): Promise<BranchA2> {
  const { branchId, sectionId } = await withPlatform(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ schoolId: seed.a.schoolId, name: 'Branch A2', signupCode: generateBranchCode() })
      .returning({ id: branches.id });
    const [s] = await tx
      .insert(sections)
      .values({ schoolId: seed.a.schoolId, branchId: b.id, grade: 8, name: '8-A2' })
      .returning({ id: sections.id });
    return { branchId: b.id, sectionId: s.id };
  });
  const { userId } = await createStaffUser(seed.a.schoolAdmin, {
    schoolId: seed.a.schoolId, branchId, role: 'teacher', username: 'a2_teacher', password: 'a-good-password-1', name: 'A2 Teacher',
  });
  return { branchId, sectionId, teacherId: userId };
}
