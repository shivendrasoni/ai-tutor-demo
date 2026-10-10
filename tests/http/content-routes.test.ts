import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { users } from '@/db/schema';
import { InMemoryQueue, LocalBlobStore, setDepsForTest } from '@/modules/content';
import { createStaffUser } from '@/modules/tenancy';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../helpers/db';
import { seedItem } from '../helpers/content';
import { buildPdf } from '../helpers/pdfs';

import * as loginRoute from '@/app/api/auth/login/route';
import * as contentRoute from '@/app/api/content/route';
import * as itemRoute from '@/app/api/content/[id]/route';
import * as retryRoute from '@/app/api/content/[id]/retry/route';
import * as exclusionsRoute from '@/app/api/content/exclusions/route';
import * as subjectsRoute from '@/app/api/subjects/route';

let seed: Seed;
let pdf: Uint8Array;
let queue: InMemoryQueue;

beforeAll(async () => {
  pdf = await buildPdf({ pages: ['Page one text', 'Page two text'] });
});
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  queue = new InMemoryQueue();
  setDepsForTest({ blobs: new LocalBlobStore(mkdtempSync(join(tmpdir(), 'route-blobs-'))), queue });
});
afterAll(async () => {
  setDepsForTest(null);
  await closeDb();
});

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

async function loginCookie(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  const res = await loginRoute.POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: SEED_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}
function jsonReq(method: string, path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) });
}
/** Multipart POST with a real content-length (as a browser sends); `declaredLength` overrides it. */
async function upload(
  fields: Record<string, string>,
  opts: { cookie?: string; file?: { bytes: Uint8Array; name: string } | null; declaredLength?: string | null } = {},
): Promise<Request> {
  const fd = new FormData();
  const file = opts.file === undefined ? { bytes: pdf, name: 'book.pdf' } : opts.file;
  if (file) fd.set('file', new File([file.bytes as BlobPart], file.name, { type: 'application/pdf' }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const probe = new Request('http://localhost/api/content', { method: 'POST', body: fd });
  const buf = new Uint8Array(await probe.arrayBuffer());
  const headers = new Headers({ 'content-type': probe.headers.get('content-type')! });
  if (opts.declaredLength === undefined) headers.set('content-length', String(buf.length));
  else if (opts.declaredLength !== null) headers.set('content-length', opts.declaredLength);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new Request('http://localhost/api/content', { method: 'POST', headers, body: buf });
}
const schoolFields = () => ({
  scope: 'school', grade: '8', subjectId: seed.a.subjectId, kind: 'book', title: 'Maths 8',
});
async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.error.code).toBe(code);
  return body;
}

describe('auth', () => {
  it('401 without a session on every content endpoint', async () => {
    const id = crypto.randomUUID();
    const responses = [
      await contentRoute.GET(get('/api/content')),
      await contentRoute.POST(await upload(schoolFields())),
      await itemRoute.DELETE(new Request(`http://localhost/api/content/${id}`, { method: 'DELETE' }), ctx({ id })),
      await retryRoute.POST(jsonReq('POST', `/api/content/${id}/retry`, {}), ctx({ id })),
      await exclusionsRoute.POST(jsonReq('POST', '/api/content/exclusions', {})),
      await subjectsRoute.GET(get('/api/subjects')),
    ];
    for (const r of responses) await expectError(r, 401, 'UNAUTHENTICATED');
  });
});

describe('upload and list', () => {
  it('school admin uploads a multipart PDF -> 201 {id}; item is queued and listed', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    const res = await contentRoute.POST(await upload(schoolFields(), { cookie }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue.jobs).toEqual([{ contentItemId: id, schoolId: seed.a.schoolId }]);
    const list = await (await contentRoute.GET(get('/api/content?grade=8', cookie))).json();
    expect(list[0]).toMatchObject({ id, title: 'Maths 8', status: 'queued', subjectName: 'Mathematics' });
  });

  it('non-PDF upload -> 400 VALIDATION not_pdf', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    const file = { bytes: new TextEncoder().encode('hello, not a pdf'), name: 'notes.pdf' };
    const body = await expectError(await contentRoute.POST(await upload(schoolFields(), { cookie, file })), 400, 'VALIDATION');
    expect(body.error.details.reason).toBe('not_pdf');
    expect(queue.jobs).toHaveLength(0);
  });

  it('missing file or bad fields -> 400 VALIDATION', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    await expectError(await contentRoute.POST(await upload(schoolFields(), { cookie, file: null })), 400, 'VALIDATION');
    for (const bad of [{ grade: '4' }, { grade: '8.5' }, { grade: 'x' }, { subjectId: 'nope' }, { scope: 'galaxy' }, { kind: 'x' }, { title: 'x'.repeat(201) }]) {
      await expectError(await contentRoute.POST(await upload({ ...schoolFields(), ...bad }, { cookie })), 400, 'VALIDATION');
    }
  });

  it('over-limit or missing content-length -> 400 too_large before the body is read; JSON is not accepted', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    const over = String(101 * 1024 * 1024 + 1);
    for (const declaredLength of [over, null, 'abc']) {
      const body = await expectError(
        await contentRoute.POST(await upload(schoolFields(), { cookie, declaredLength })), 400, 'VALIDATION',
      );
      expect(body.error.details.reason).toBe('too_large');
    }
    const asJson = await contentRoute.POST(jsonReq('POST', '/api/content', schoolFields(), cookie));
    await expectError(asJson, 400, 'VALIDATION');
    expect(queue.jobs).toHaveLength(0);
  });

  it('student -> 403 on upload/list/subjects', async () => {
    const cookie = await loginCookie(seed.a.student.userId);
    await expectError(await contentRoute.POST(await upload(schoolFields(), { cookie })), 403, 'FORBIDDEN');
    await expectError(await contentRoute.GET(get('/api/content', cookie)), 403, 'FORBIDDEN');
    await expectError(await subjectsRoute.GET(get('/api/subjects', cookie)), 403, 'FORBIDDEN');
  });

  it('assigned teacher uploads a section material; unassigned teacher is 403', async () => {
    const fields = {
      scope: 'section', kind: 'material', grade: '8', subjectId: seed.a.subjectId,
      branchId: seed.a.branchId, sectionId: seed.a.sectionId, title: 'Worksheet',
    };
    const ok = await contentRoute.POST(await upload(fields, { cookie: await loginCookie(seed.a.teacherId) }));
    expect(ok.status).toBe(201);

    const { userId } = await createStaffUser(seed.a.schoolAdmin, {
      schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher',
      username: 'unassigned_t', password: SEED_PASSWORD, name: 'Unassigned',
    });
    const res = await contentRoute.POST(await upload(fields, { cookie: await loginCookie(userId) }));
    await expectError(res, 403, 'FORBIDDEN');
  });
});

describe('list filters', () => {
  it('malformed branchId, subjectId and grade are 400 VALIDATION, never 500', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    for (const q of ['branchId=abc', 'subjectId=1', 'grade=4', 'grade=13', 'grade=8.5', 'grade=x', 'grade=-8', 'branchId=']) {
      await expectError(await contentRoute.GET(get(`/api/content?${q}`, cookie)), 400, 'VALIDATION');
    }
  });

  it('valid filters narrow the list; a school admin with a null branch can filter by branch', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    await seedItem(seed.a, { title: 'Eight', grade: 8 });
    await seedItem(seed.a, { title: 'Nine', grade: 9 });
    const g9 = await (await contentRoute.GET(get('/api/content?grade=9', cookie))).json();
    expect(g9.map((r: { title: string }) => r.title)).toEqual(['Nine']);
    const byBranch = await contentRoute.GET(
      get(`/api/content?branchId=${seed.a.branchId}&subjectId=${seed.a.subjectId}`, cookie),
    );
    expect(byBranch.status).toBe(200);
    expect(await byBranch.json()).toHaveLength(2);
  });

  it('platform admin can list with a branch filter', async () => {
    const cookie = await loginCookie(seed.platform.userId);
    await seedItem(seed.a);
    const res = await contentRoute.GET(get(`/api/content?branchId=${seed.a.branchId}`, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});

describe('delete, retry, exclusions, subjects', () => {
  it('DELETE of another school item -> 404; own item -> 200 {}', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    const other = await seedItem(seed.b);
    await expectError(
      await itemRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE', headers: { cookie } }), ctx({ id: other.id })),
      404, 'NOT_FOUND',
    );
    const own = await seedItem(seed.a);
    const res = await itemRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE', headers: { cookie } }), ctx({ id: own.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    await expectError(
      await itemRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE', headers: { cookie } }), ctx({ id: 'not-a-uuid' })),
      404, 'NOT_FOUND',
    );
  });

  it('retry on a non-failed item -> 400; on a failed item -> 200 and status queued', async () => {
    const cookie = await loginCookie(seed.a.schoolAdmin.userId);
    const ready = await seedItem(seed.a);
    await expectError(await retryRoute.POST(jsonReq('POST', '/x', {}, cookie), ctx({ id: ready.id })), 400, 'VALIDATION');
    const failed = await seedItem(seed.a, { ingestStatus: 'failed', ingestError: 'boom' });
    const res = await retryRoute.POST(jsonReq('POST', '/x', {}, cookie), ctx({ id: failed.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(queue.jobs).toEqual([{ contentItemId: failed.id, schoolId: seed.a.schoolId }]);
    const list = await (await contentRoute.GET(get('/api/content', cookie))).json();
    expect(list.find((r: { id: string }) => r.id === failed.id)).toMatchObject({ status: 'queued', ingestError: null });
  });

  it('exclusions toggles hide/unhide for a branch admin; GET shows excludedBranchIds', async () => {
    const cookie = await loginCookie(seed.a.branchAdmin.userId);
    const item = await seedItem(seed.a);
    const body = { branchId: seed.a.branchId, contentItemId: item.id, excluded: true };
    const hide = await exclusionsRoute.POST(jsonReq('POST', '/api/content/exclusions', body, cookie));
    expect(hide.status).toBe(200);
    expect(await hide.json()).toEqual({});
    let list = await (await contentRoute.GET(get('/api/content', cookie))).json();
    expect(list[0].excludedBranchIds).toEqual([seed.a.branchId]);
    await exclusionsRoute.POST(jsonReq('POST', '/api/content/exclusions', { ...body, excluded: false }, cookie));
    list = await (await contentRoute.GET(get('/api/content', cookie))).json();
    expect(list[0].excludedBranchIds).toEqual([]);
    await expectError(await exclusionsRoute.POST(jsonReq('POST', '/api/content/exclusions', { ...body, branchId: 'x' }, cookie)), 400, 'VALIDATION');
    await expectError(await exclusionsRoute.POST(jsonReq('POST', '/api/content/exclusions', { ...body, excluded: 'yes' }, cookie)), 400, 'VALIDATION');
  });

  it('GET /api/subjects lists the school subjects for staff only', async () => {
    const res = await subjectsRoute.GET(get('/api/subjects', await loginCookie(seed.a.teacherId)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: seed.a.subjectId, name: 'Mathematics' }]);
    await expectError(await subjectsRoute.GET(get('/api/subjects', await loginCookie(seed.a.studentId))), 403, 'FORBIDDEN');
  });
});
