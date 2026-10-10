import { z } from 'zod';
import { handle, json, readJson } from '@/lib/http';
import { clientIp, enforce, limits, WINDOW_1_HOUR } from '@/lib/rate-limit';
import { signupWithCode } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// Shape and size caps only; signupWithCode owns the field rules, credential rules and code checks.
const Body = z.object({
  code: z.string().max(64),
  grade: z.number(),
  sectionId: z.string().max(64).optional(),
  studentName: z.string().max(200),
  parentName: z.string().max(200),
  parentPhone: z.string().max(32),
  parentEmail: z.string().max(254).optional(),
  planId: z.string().max(64),
  username: z.string().max(200),
  password: z.string().max(128),
});

export const POST = handle(async (req: Request) => {
  await enforce(`join:submit:${clientIp(req)}`, limits.joinSubmitPerIp(), WINDOW_1_HOUR);
  const body = await readJson(req, Body);
  return json(await signupWithCode(body), { status: 201 });
});
