import { z } from 'zod';
import { handle, json, parseWith, readJson, requireActor } from '@/lib/http';
import { listArtifacts, requestArtifact } from '@/modules/studytools';

export const dynamic = 'force-dynamic';

const TYPES = ['practice_test', 'mock_exam', 'study_notes', 'last_night_notes'] as const;

const createBody = z.object({
  type: z.enum(TYPES),
  subjectId: z.uuid(),
  chapterIds: z.array(z.uuid()).min(1).max(6),
  questionCount: z.number().int().min(5).max(30).optional(),
  patternKey: z.string().min(1).max(64).optional(),
});
const listQuery = z.object({ type: z.enum(TYPES).optional() });

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, createBody);
  return json(await requestArtifact(actor, body), { status: 201 });
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { type } = parseWith(listQuery, { type: new URL(req.url).searchParams.get('type') ?? undefined });
  return json(await listArtifacts(actor, { type }));
});
