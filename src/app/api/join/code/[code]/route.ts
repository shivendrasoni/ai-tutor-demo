import { DomainError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { findBranchByCode, listSectionsForBranch } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const branch = await findBranchByCode(code);
  if (!branch) throw new DomainError('INVALID_CODE', 'Unknown signup code');
  if (!branch.enabled) throw new DomainError('CODE_DISABLED', 'This signup code is disabled');
  const sections = await listSectionsForBranch(branch.schoolId, branch.branchId);
  return json({ schoolName: branch.schoolName, branchName: branch.branchName, sections });
});
