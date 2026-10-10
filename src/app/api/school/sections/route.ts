import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { createSection } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

// Shape check only; createSection owns the grade range, the name rules and branch scoping (a malformed or
// foreign branch id is NOT_FOUND, a branch_admin's other branch is too).
const Body = z.object({ branchId: z.string().max(64), grade: z.number(), name: z.string().max(200) });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const { id } = await createSection(actor, body);
  return json({ id }, { status: 201 });
});
