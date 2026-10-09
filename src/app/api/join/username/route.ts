import { z } from 'zod';
import { handle, json, parseWith } from '@/lib/http';
import { checkUsername } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

const Query = z.object({ u: z.string().min(1).max(200) });

export const GET = handle(async (req: Request) => {
  const { u } = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams), 'Query parameter u is required');
  return json(await checkUsername(u));
});
