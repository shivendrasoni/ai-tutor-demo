import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { enrollmentSummary, listBranches } from '@/modules/analytics';

export const dynamic = 'force-dynamic';

const Query = z.object({ schoolId: z.uuid().optional(), branchId: z.uuid().optional() });

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { schoolId, branchId } = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Invalid filters');
  // The service enforces schoolId scope (never widened for a branch_admin).
  let summary = await enrollmentSummary(actor, { schoolId });
  if (branchId !== undefined) {
    if (!actor.isPlatformAdmin) {
      if (actor.roles.includes('school_admin')) {
        const own = await listBranches(actor);
        if (!own.some((b) => b.branchId === branchId)) throw new DomainError('FORBIDDEN');
      } else if (branchId !== actor.branchId) {
        throw new DomainError('FORBIDDEN');
      }
    }
    summary = summary.filter((r) => r.branchId === branchId);
  }
  return json({ summary });
});
