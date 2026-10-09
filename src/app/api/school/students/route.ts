import { z } from 'zod';
import { handle, json, parseWith, readJson, requireActor } from '@/lib/http';
import { listStudents, manualAddStudent } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

const Query = z.object({
  schoolId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  grade: z.string().regex(/^\d+$/, 'grade must be an integer').transform(Number).optional(),
  status: z.enum(['pending_payment', 'active', 'lapsed', 'removed']).optional(),
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const filters = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Invalid filters');
  const students = await listStudents(actor, filters);
  return json({ students: students.map((s) => ({ ...s, periodEnd: s.periodEnd?.toISOString() ?? null })) });
});

const Body = z.object({
  branchId: z.string(),
  grade: z.number(),
  sectionId: z.string().optional(),
  studentName: z.string(),
  parentName: z.string(),
  parentPhone: z.string(),
  parentEmail: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const { inviteUrl } = await manualAddStudent(actor, body);
  return json({ inviteUrl }, { status: 201 });
});
