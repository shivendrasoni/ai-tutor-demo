import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { listVisibleChapters, studentScope } from '@/modules/content';

export const dynamic = 'force-dynamic';

const query = z.object({ subjectId: z.uuid() });

/** Chapters of a subject that the active student can see (for the create form's chapter picker). */
export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const { subjectId } = parseWith(query, { subjectId: new URL(req.url).searchParams.get('subjectId') ?? undefined });
  const scope = await studentScope(actor);
  const chapters = await listVisibleChapters(scope, subjectId);
  return json(chapters.map((c) => ({ id: c.id, title: c.title, itemTitle: c.itemTitle, ordinal: c.ordinal })));
});
