import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, seedStudyContent } from '../helpers/study';

import * as loginRoute from '@/app/api/auth/login/route';
import * as chaptersRoute from '@/app/api/study/chapters/route';

let seed: Seed;
let ids: { subjectId: string; chapterIds: string[] };

const req = (path: string, cookie?: string) => new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
async function loginCookie(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  const res = await loginRoute.POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: SEED_PASSWORD }),
    }),
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await activateStudent(seed.b.student);
  ids = await seedStudyContent(seed.a);
});
afterAll(() => closeDb());

describe('GET /api/study/chapters', () => {
  it('lists the visible chapters of a subject for an active student', async () => {
    const cookie = await loginCookie(seed.a.student.userId!);
    const res = await chaptersRoute.GET(req(`/api/study/chapters?subjectId=${ids.subjectId}`, cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string }[];
    expect(body.map((c) => c.id)).toEqual(ids.chapterIds);
    expect(body[0]!.title).toBe('Chapter 1');
  });

  it('hides another school\'s content, rejects a bad subjectId, and requires login', async () => {
    const other = await loginCookie(seed.b.student.userId!);
    const none = await chaptersRoute.GET(req(`/api/study/chapters?subjectId=${ids.subjectId}`, other));
    expect(await none.json()).toEqual([]);
    const cookie = await loginCookie(seed.a.student.userId!);
    expect((await chaptersRoute.GET(req('/api/study/chapters?subjectId=nope', cookie))).status).toBe(400);
    expect((await chaptersRoute.GET(req(`/api/study/chapters?subjectId=${ids.subjectId}`))).status).toBe(401);
  });
});
