import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { assignTeacher } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ teacherId: z.string().max(64), sectionId: z.string().max(64), subjectId: z.string().max(64) });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  // A malformed id can never name a row: report it as not found (the service re-checks scope and membership).
  if (!UUID_RE.test(body.teacherId)) throw new DomainError('NOT_FOUND', 'Teacher not found');
  if (!UUID_RE.test(body.sectionId)) throw new DomainError('NOT_FOUND', 'Section not found');
  if (!UUID_RE.test(body.subjectId)) throw new DomainError('NOT_FOUND', 'Subject not found');
  await assignTeacher(actor, body);
  return json({ ok: true }, { status: 201 });
});
