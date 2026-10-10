import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { readUpload } from '@/lib/multipart';
import { listContent, uploadContent } from '@/modules/content';

export const dynamic = 'force-dynamic';

const Query = z.object({
  branchId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  grade: z
    .string()
    .regex(/^\d+$/, 'grade must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(5).max(12))
    .optional(),
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const filter = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Invalid filters');
  return json(await listContent(actor, filter));
});

const text = (max: number) => z.string().max(max);
const Fields = z.object({
  scope: z.enum(['school', 'branch', 'section']),
  kind: z.enum(['book', 'material']),
  title: text(200),
  grade: z
    .string()
    .regex(/^\d+$/, 'grade must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(5).max(12)),
  subjectId: z.uuid(),
  schoolId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const form = await readUpload(req);
  const file = form.get('file');
  if (!(file instanceof File)) throw new DomainError('VALIDATION', 'A file is required', { field: 'file' });
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(Fields.shape)) {
    const v = form.get(key);
    // Empty optional inputs from the browser form mean "not provided".
    if (typeof v === 'string' && v !== '') fields[key] = v;
  }
  const f = parseWith(Fields, fields, 'Invalid upload');
  const schoolId = f.schoolId ?? actor.schoolId;
  if (!schoolId) throw new DomainError('VALIDATION', 'schoolId is required', { field: 'schoolId' });
  const { id } = await uploadContent(actor, {
    scope: f.scope,
    kind: f.kind,
    title: f.title,
    grade: f.grade,
    subjectId: f.subjectId,
    schoolId,
    branchId: f.branchId,
    sectionId: f.sectionId,
    file: { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name },
  });
  return json({ id }, { status: 201 });
});
