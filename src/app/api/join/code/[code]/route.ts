import { DomainError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { clientIp, enforce, limits, WINDOW_15_MIN } from '@/lib/rate-limit';
import { findBranchByCode, listSectionsForBranch } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  await enforce(`join:lookup:${clientIp(req)}`, limits.joinLookupPerIp(), WINDOW_15_MIN);
  const { code } = await ctx.params;
  const branch = await findBranchByCode(code);
  if (!branch) throw new DomainError('INVALID_CODE', 'This branch code is not valid');
  if (!branch.enabled) throw new DomainError('CODE_DISABLED', 'Signups with this branch code are turned off');
  const sections = await listSectionsForBranch(branch.schoolId, branch.branchId);
  return json({ schoolName: branch.schoolName, branchName: branch.branchName, sections });
});
