import { handle, json, requireActor } from '@/lib/http';
import { studentStatus } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const s = await studentStatus(actor);
  return json({ status: s.status, planName: s.planName, periodEnd: s.periodEnd?.toISOString() ?? null });
});
