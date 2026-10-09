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
  branchId: z.string().max(64),
  grade: z.number(),
  sectionId: z.string().max(64).optional(),
  studentName: z.string().max(200),
  parentName: z.string().max(200),
  parentPhone: z.string().max(32),
  parentEmail: z.string().max(254).optional(),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const { inviteUrl } = await manualAddStudent(actor, body);
  return json({ inviteUrl }, { status: 201 });
});
