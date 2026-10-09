import { z } from 'zod';
import { handle, json, readJson } from '@/lib/http';
import { signupWithCode } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

// Shape check only; the service owns the detailed rules (grade range, credentials, section/branch).
const Body = z.object({
  code: z.string(),
  grade: z.number(),
  sectionId: z.string().optional(),
  studentName: z.string(),
  parentName: z.string(),
  parentPhone: z.string(),
  parentEmail: z.string().optional(),
  planId: z.string(),
  username: z.string(),
  password: z.string(),
});

export const POST = handle(async (req: Request) => {
  const body = await readJson(req, Body);
  const r = await signupWithCode(body);
  return json({ studentUserId: r.studentUserId, subscriptionId: r.subscriptionId }, { status: 201 });
});
