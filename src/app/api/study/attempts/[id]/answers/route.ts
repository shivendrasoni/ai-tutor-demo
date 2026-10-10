import { z } from 'zod';
import { handle, readJson, requireActor } from '@/lib/http';
import { saveAnswers } from '@/modules/studytools';
import { idParam, type IdCtx } from '../../../_params';

export const dynamic = 'force-dynamic';

// 30 answers of up to 10000 characters each exceed the default 100 KB body cap.
const ANSWERS_MAX_BYTES = 400 * 1024;
// Shape only; the service validates ids and value types against the artifact (all-or-nothing).
const body = z.object({ answers: z.record(z.string().max(100), z.union([z.number(), z.string().max(10_000)])) });

export const PUT = handle(async (req: Request, ctx: IdCtx) => {
  const actor = await requireActor(req);
  const id = await idParam(ctx);
  const { answers } = await readJson(req, body, ANSWERS_MAX_BYTES);
  await saveAnswers(actor, id, answers);
  return new Response(null, { status: 204 });
});
