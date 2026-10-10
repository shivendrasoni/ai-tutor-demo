import { handle, json, requireActor } from '@/lib/http';
import { studentScope } from '@/modules/content';
import { listExamPatterns, type ExamPatternRow } from '@/modules/studytools';

export const dynamic = 'force-dynamic';

/** Students get the patterns for their grade; staff get every pattern. */
export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  if (actor.roles.includes('student')) {
    const { grade } = await studentScope(actor);
    return json(await listExamPatterns(grade));
  }
  const byKey = new Map<string, ExamPatternRow>();
  for (const rows of await Promise.all(Array.from({ length: 12 }, (_, i) => listExamPatterns(i + 1)))) {
    for (const r of rows) byKey.set(r.key, r);
  }
  return json([...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)));
});
