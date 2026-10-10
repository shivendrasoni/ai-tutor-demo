import { z } from 'zod';
import { handle, json, parseWith, readJson, requireActor } from '@/lib/http';
import { listStudents, manualAddStudent } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

const Query = z.object({
  schoolId: z.string().max(64).optional(),
  branchId: z.string().max(64).optional(),
  grade: z
    .string()
    .regex(/^\d{1,3}$/, 'grade must be a whole number')
    .transform(Number)
    .optional(),
  status: z.enum(['pending_payment', 'active', 'lapsed', 'removed']).optional(),
});

// Shape and size caps only; manualAddStudent owns the field rules and authorization.
const Body = z.object({
  branchId: z.string().max(64),
  grade: z.number(),
  sectionId: z.string().max(64).optional(),
  studentName: z.string().max(200),
  parentName: z.string().max(200),
  parentPhone: z.string().max(32),
  parentEmail: z.string().max(254).optional(),
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const filter = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Invalid filters');
  return json({ students: await listStudents(actor, filter) });
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  const { inviteUrl } = await manualAddStudent(actor, body);
  return json({ inviteUrl }, { status: 201 });
});
