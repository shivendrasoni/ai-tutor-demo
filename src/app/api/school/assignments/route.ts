import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { isUuid } from '@/lib/uuid';
import { assignTeacher } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ teacherId: z.string().max(64), sectionId: z.string().max(64), subjectId: z.string().max(64) });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  // A malformed id can never name a row: report it as not found (the service re-checks scope and membership).
  if (!isUuid(body.teacherId)) throw new DomainError('NOT_FOUND', 'Teacher not found');
  if (!isUuid(body.sectionId)) throw new DomainError('NOT_FOUND', 'Section not found');
  if (!isUuid(body.subjectId)) throw new DomainError('NOT_FOUND', 'Subject not found');
  await assignTeacher(actor, body);
  return json({ ok: true }, { status: 201 });
});
