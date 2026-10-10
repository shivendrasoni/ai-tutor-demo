import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { chapterProgress } from '@/modules/studytools';

export const dynamic = 'force-dynamic';

const query = z.object({
  subjectId: z.uuid().optional(),
  studentIds: z.array(z.uuid()).max(200).optional(),
});

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const raw = sp.get('studentIds');
  const q = parseWith(query, {
    subjectId: sp.get('subjectId') ?? undefined,
    studentIds: raw === null ? undefined : raw.split(',').filter(Boolean),
  });
  return json(await chapterProgress(actor, q));
});
