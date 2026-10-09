import { z } from 'zod';
import { handle, json, readJson } from '@/lib/http';
import { signupWithCode } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// Shape check only; the service owns the detailed rules (grade range, credentials, section/branch).
const Body = z.object({
  code: z.string().max(32),
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
  const body = await readJson(req, Body);
  const r = await signupWithCode(body);
  return json({ studentUserId: r.studentUserId, subscriptionId: r.subscriptionId }, { status: 201 });
});
