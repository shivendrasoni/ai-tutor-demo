import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { sectionProgress } from '@/modules/analytics';

export const dynamic = 'force-dynamic';

const Query = z.object({ sectionId: z.uuid(), subjectId: z.uuid() });

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const q = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'sectionId and subjectId are required');
  return json({ progress: await sectionProgress(actor, q) });
});
