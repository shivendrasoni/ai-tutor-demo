import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { isUuid } from '@/lib/uuid';
import { createStaffUser, normalizeUsername } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

// Shape check only; createStaffUser owns username/password rules and authorization. The school comes from the
// session. The password is hashed and never returned.
const Body = z.object({
  branchId: z.string().max(64),
  username: z.string().max(64),
  password: z.string().max(128),
  name: z.string().max(200),
  email: z.string().max(254).optional(),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  if (!actor.schoolId) throw new DomainError('FORBIDDEN');
  if (!isUuid(body.branchId)) throw new DomainError('NOT_FOUND', 'Branch not found');
  const { userId } = await createStaffUser(actor, { ...body, schoolId: actor.schoolId, role: 'teacher' });
  return json({ userId, username: normalizeUsername(body.username) }, { status: 201 });
});
