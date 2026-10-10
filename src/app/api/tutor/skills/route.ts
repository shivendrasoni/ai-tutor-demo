import { z } from 'zod';
import { handle, json, parseWith, requireActor } from '@/lib/http';
import { listSkills } from '@/modules/tutor';

export const dynamic = 'force-dynamic';

const query = z.object({ kind: z.enum(['chat', 'generator', 'grader']).optional() });

export const GET = handle(async (req: Request) => {
  await requireActor(req);
  const { kind } = parseWith(query, { kind: new URL(req.url).searchParams.get('kind') ?? undefined });
  const rows = await listSkills(kind);
  return json(rows.map(({ id, key, name, kind, tools, enabled }) => ({ id, key, name, kind, tools, enabled })));
});
