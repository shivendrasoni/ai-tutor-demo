import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { createSubject } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

// The school always comes from the session, never the body. createSubject requires school_admin.
const Body = z.object({ name: z.string().max(200) });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { name } = await readJson(req, Body);
  if (!actor.schoolId) throw new DomainError('FORBIDDEN');
  const { id } = await createSubject(actor, { schoolId: actor.schoolId, name });
  return json({ id }, { status: 201 });
});
