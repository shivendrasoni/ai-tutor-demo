import { z } from 'zod';
import { handle, json, readJson, requireActor } from '@/lib/http';
import { listSchools } from '@/modules/analytics';
import { createSchool } from '@/modules/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(1).max(200), board: z.string().trim().min(1).max(50) });

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  return json({ schools: await listSchools(actor) });
});

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body = await readJson(req, Body);
  return json(await createSchool(actor, body), { status: 201 });
});
