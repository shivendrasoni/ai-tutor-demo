import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { artifacts, attempts, contentItems, skills, studentProfiles, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { seedSkills } from '@/modules/tutor/skills';
import { resetDb, SEED_PASSWORD, seedTwoSchools, type Seed } from '../../tests/helpers/db';

// Cross-role security, isolation, error envelopes, session/cookie rules, logout and responsive/a11y basics.
// Payments are out of scope: no payment endpoint or payment page is driven. Active students are created the
// way the repo's own tests do it (profile status set to `active`), without recording a payment.

type Who = 'anon' | 'studentActive' | 'studentPending' | 'teacher' | 'schoolAdmin' | 'branchAdmin' | 'platform';
type Creds = { username: string; password: string };
type World = {
  seed: Seed;
  creds: Record<Exclude<Who, 'anon'>, Creds>;
  bStudent: Creds;
};

const ACTORS: Who[] = ['anon', 'studentActive', 'studentPending', 'teacher', 'schoolAdmin', 'branchAdmin', 'platform'];
const UUID_NONE = '00000000-0000-4000-8000-0000000000aa';
const HYDRATION = /hydrat|Minified React error #(418|419|420|421|422|423|425)|Text content does not match/i;
const LEAK = /DrizzleQueryError|\bSELECT\b|\bINSERT INTO\b|\bpg_[a-z]|ECONNREFUSED|\n\s+at |\.ts:\d+|stack trace/i;

// ---------- world ----------

async function usernameOf(userId: string): Promise<string> {
  const [u] = await withPlatform((tx) => tx.select({ username: users.username }).from(users).where(eq(users.id, userId)));
  return u.username!;
}

async function createWorld(): Promise<World> {
  await resetDb();
  const seed = await seedTwoSchools();
  const active = await signupWithCode({
    code: seed.a.code,
    grade: 8,
    studentName: 'Active Kid',
    parentName: 'Active Parent',
    parentPhone: '9000000002',
    planId: seed.planId,
    username: 'active.kid',
    password: SEED_PASSWORD,
  });
  // Same effect as tests/helpers/tutor.ts `activate`: profile status only, no payment recorded.
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, active.studentUserId)),
  );
  const c = async (userId: string): Promise<Creds> => ({ username: await usernameOf(userId), password: SEED_PASSWORD });
  return {
    seed,
    creds: {
      studentActive: await c(active.studentUserId),
      studentPending: await c(seed.a.studentId),
      teacher: await c(seed.a.teacher.userId!),
      schoolAdmin: await c(seed.a.schoolAdmin.userId!),
      branchAdmin: await c(seed.a.branchAdmin.userId!),
      platform: await c(seed.platform.userId!),
    },
    bStudent: await c(seed.b.studentId),
  };
}

// ---------- browser helpers ----------

type Probe = { pageErrors: string[]; consoleErrors: string[] };

function watch(page: Page): Probe {
  const p: Probe = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (e) => p.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') p.consoleErrors.push(m.text());
  });
  return p;
}

async function loginAs(page: Page, c: Creds): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(c.username);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login', { timeout: 30_000 });
}

async function observe(page: Page, probe: Probe, route: string) {
  probe.pageErrors.length = 0;
  probe.consoleErrors.length = 0;
  const resp = await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const pathname = new URL(page.url()).pathname;
  const notAllowed = (await page.getByRole('heading', { name: 'Not allowed', exact: true }).count()) > 0;
  return { status: resp?.status() ?? 0, pathname, notAllowed };
}

const UNLABELED = () => {
  const bad: string[] = [];
  document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((el) => {
    const input = el as HTMLInputElement;
    if (input.type === 'submit' || input.type === 'button') return;
    const labelled =
      (input.labels && input.labels.length > 0) ||
      input.hasAttribute('aria-label') ||
      input.hasAttribute('aria-labelledby') ||
      (input.title || '').length > 0;
    if (!labelled) bad.push(input.outerHTML.slice(0, 160));
  });
  return bad;
};

/** Checks run on every page reached: HTTP status, uncaught errors, hydration, one h1, no horizontal scroll at 390 and 1280, labelled controls. */
async function inspect(page: Page, probe: Probe, where: string, status: number): Promise<void> {
  expect.soft(status, `${where}: HTTP status below 500`).toBeLessThan(500);
  const hyd = probe.consoleErrors.filter((t) => HYDRATION.test(t));
  const other = probe.consoleErrors.filter((t) => !HYDRATION.test(t));
  if (other.length) console.log(`[console-error] ${where}: ${other.map((s) => s.slice(0, 220)).join(' | ')}`);
  expect.soft(probe.pageErrors, `${where}: uncaught page errors`).toEqual([]);
  expect.soft(hyd, `${where}: hydration errors`).toEqual([]);
  expect.soft(await page.locator('h1').count(), `${where}: number of h1 elements`).toBe(1);

  const widths = () =>
    page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const narrow = await widths();
  expect
    .soft(narrow.sw <= narrow.cw, `${where}: horizontal scroll at 390px (scrollWidth ${narrow.sw} > clientWidth ${narrow.cw})`)
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await widths();
  expect
    .soft(wide.sw <= wide.cw, `${where}: horizontal scroll at 1280px (scrollWidth ${wide.sw} > clientWidth ${wide.cw})`)
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });

  expect.soft(await page.evaluate(UNLABELED), `${where}: form controls without an accessible label`).toEqual([]);
}

/** Inserts a ready school content item (platform context), the same shape tests/helpers/content.ts seedItem uses. */
async function insertContentItem(schoolId: string, subjectId: string, uploadedBy: string, title: string): Promise<string> {
  const [row] = await withPlatform((tx) =>
    tx
      .insert(contentItems)
      .values({
        schoolId,
        grade: 8,
        subjectId,
        kind: 'book',
        scope: 'school',
        title,
        fileKey: `${schoolId}/${title.replace(/\W+/g, '-').toLowerCase()}.pdf`,
        uploadedBy,
        ingestStatus: 'ready',
        sizeBytes: 1000,
      })
      .returning({ id: contentItems.id }),
  );
  return row.id;
}

// ---------- role access matrix ----------

const L = (to: string) => `redirect:${to}`;
type Exp = 'page' | 'not-allowed' | string;

// Column order follows ACTORS: anon, studentActive, studentPending, teacher, schoolAdmin, branchAdmin, platform.
// Derived from requirePageActor/checkPageAccess (src/lib/guard.ts), requireStaffPageActor and the per-page role checks.
const PLATFORM_ROW: Exp[] = [L('/login'), L('/learn'), L('/status'), L('/teacher'), L('/school'), L('/school'), 'page'];
const MATRIX: [string, Exp[]][] = [
  ['/learn', [L('/login'), 'page', L('/status'), L('/teacher'), L('/school'), L('/school'), L('/platform')]],
  ['/learn/study', [L('/login'), 'page', L('/status'), L('/teacher'), L('/school'), L('/school'), L('/platform')]],
  // Client-side: /api/me/status decides; the anonymous 401 redirects to /login, active students go to /learn.
  ['/status', [L('/login'), L('/learn'), 'page', 'page', 'page', 'page', 'page']],
  ['/school', [L('/login'), L('/learn'), L('/status'), L('/teacher'), 'page', 'page', L('/platform')]],
  // Staff-layout pages: no role redirect, they render "Not allowed" for roles outside the page's list.
  ['/school/content', [L('/login'), 'not-allowed', 'not-allowed', 'not-allowed', 'page', 'page', 'page']],
  ['/teacher', [L('/login'), L('/learn'), L('/status'), 'page', L('/school'), L('/school'), L('/platform')]],
  ['/teacher/materials', [L('/login'), 'not-allowed', 'not-allowed', 'page', 'not-allowed', 'not-allowed', 'not-allowed']],
  ['/platform', PLATFORM_ROW],
  ['/platform/schools', PLATFORM_ROW],
  ['/platform/plans', PLATFORM_ROW],
  ['/platform/flags', PLATFORM_ROW],
  ['/platform/costs', PLATFORM_ROW],
  ['/platform/routing', PLATFORM_ROW],
];

for (const [i, who] of ACTORS.entries()) {
  test(`role matrix: ${who} reaches only the pages it should`, async ({ page }) => {
    test.setTimeout(420_000);
    const w = await createWorld();
    const probe = watch(page);
    if (who !== 'anon') {
      const c = who === 'studentActive' ? w.creds.studentActive : w.creds[who];
      await loginAs(page, c);
    }
    for (const [route, row] of MATRIX) {
      const exp = row[i];
      const where = `${who} ${route}`;
      const obs = await observe(page, probe, route);
      const observed = obs.pathname !== route ? `redirect:${obs.pathname}` : obs.notAllowed ? 'not-allowed' : 'page';
      expect.soft(observed, `${where}: expected ${exp}`).toBe(exp);
      await inspect(page, probe, where, obs.status);
    }
  });
}

// ---------- API authorization ----------

type Req = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; data?: unknown };

// Every gated route family. requireActor runs before any body parsing in each handler, so placeholder ids are fine.
const ANON_GATED: Req[] = [
  { method: 'GET', path: '/api/me' },
  { method: 'GET', path: '/api/me/status' },
  { method: 'GET', path: '/api/subjects' },
  { method: 'GET', path: '/api/tutor/subjects' },
  { method: 'GET', path: '/api/tutor/skills' },
  { method: 'GET', path: '/api/tutor/conversations' },
  { method: 'POST', path: '/api/tutor/conversations', data: { skillKey: 'socratic' } },
  { method: 'GET', path: `/api/tutor/conversations/${UUID_NONE}/messages` },
  { method: 'POST', path: `/api/tutor/messages/${UUID_NONE}/feedback`, data: { rating: 'up' } },
  { method: 'GET', path: '/api/study/chapters' },
  { method: 'GET', path: '/api/study/patterns' },
  { method: 'GET', path: '/api/study/progress' },
  { method: 'GET', path: '/api/study/artifacts' },
  { method: 'POST', path: '/api/study/artifacts', data: {} },
  { method: 'GET', path: `/api/study/artifacts/${UUID_NONE}` },
  { method: 'POST', path: `/api/study/artifacts/${UUID_NONE}/attempts` },
  { method: 'GET', path: `/api/study/attempts/${UUID_NONE}` },
  { method: 'PUT', path: `/api/study/attempts/${UUID_NONE}/answers`, data: { answers: {} } },
  { method: 'POST', path: `/api/study/attempts/${UUID_NONE}/submit` },
  { method: 'GET', path: '/api/content' },
  { method: 'DELETE', path: `/api/content/${UUID_NONE}` },
  { method: 'POST', path: `/api/content/${UUID_NONE}/retry` },
  { method: 'POST', path: '/api/content/exclusions', data: {} },
  { method: 'GET', path: '/api/teacher/progress' },
  { method: 'GET', path: '/api/teacher/usage' },
  { method: 'GET', path: '/api/school/enrollment' },
  { method: 'GET', path: '/api/school/students' },
  { method: 'POST', path: '/api/school/students', data: {} },
  { method: 'POST', path: `/api/school/students/${UUID_NONE}/invite` },
  { method: 'POST', path: `/api/school/students/${UUID_NONE}/password`, data: { password: 'x' } },
  { method: 'POST', path: `/api/school/students/${UUID_NONE}/remove` },
  { method: 'POST', path: '/api/school/teachers', data: {} },
  { method: 'POST', path: '/api/school/subjects', data: { name: 'x' } },
  { method: 'POST', path: '/api/school/sections', data: {} },
  { method: 'POST', path: '/api/school/assignments', data: {} },
  { method: 'POST', path: `/api/school/branches/${UUID_NONE}/code`, data: { action: 'rotate' } },
  { method: 'GET', path: '/api/platform/schools' },
  { method: 'POST', path: '/api/platform/schools', data: {} },
  { method: 'POST', path: `/api/platform/schools/${UUID_NONE}/branches`, data: { name: 'x' } },
  { method: 'GET', path: '/api/platform/plans' },
  { method: 'POST', path: '/api/platform/plans', data: {} },
  { method: 'GET', path: '/api/platform/pending' },
  { method: 'GET', path: '/api/platform/costs' },
  { method: 'GET', path: '/api/platform/routing' },
  { method: 'GET', path: '/api/platform/flags' },
  { method: 'POST', path: `/api/platform/flags/${UUID_NONE}/review` },
];

// Wrong-role probes: each must return 403 FORBIDDEN from the module's role check. Bodies are valid so the
// role check, not validation, decides the response. Payment endpoints are deliberately excluded.
type WrongRole = Req & { actors: Who[] };
const WRONG_ROLE = (w: World, contentId: string): WrongRole[] => {
  const a = w.seed.a;
  const q = `sectionId=${a.sectionId}&subjectId=${a.subjectId}`;
  return [
    { method: 'GET', path: '/api/platform/schools', actors: ['schoolAdmin', 'teacher', 'studentActive'] },
    { method: 'GET', path: '/api/platform/plans', actors: ['schoolAdmin', 'teacher'] },
    { method: 'GET', path: '/api/platform/pending', actors: ['teacher', 'studentActive'] },
    { method: 'GET', path: '/api/platform/costs?days=7', actors: ['teacher', 'schoolAdmin'] },
    { method: 'GET', path: '/api/platform/routing?days=7', actors: ['schoolAdmin'] },
    { method: 'GET', path: '/api/platform/flags?status=open', actors: ['teacher'] },
    { method: 'GET', path: '/api/school/students', actors: ['teacher', 'studentActive'] },
    { method: 'GET', path: '/api/school/enrollment', actors: ['teacher', 'studentActive'] },
    { method: 'POST', path: '/api/school/sections', data: { branchId: a.branchId, grade: 8, name: 'Probe' }, actors: ['teacher', 'studentActive'] },
    { method: 'GET', path: `/api/teacher/progress?${q}`, actors: ['studentActive', 'platform'] },
    { method: 'POST', path: '/api/study/artifacts', data: { type: 'practice_test', subjectId: a.subjectId, chapterIds: [UUID_NONE] }, actors: ['teacher', 'schoolAdmin'] },
    { method: 'POST', path: '/api/tutor/conversations', data: { skillKey: 'socratic' }, actors: ['teacher', 'schoolAdmin', 'platform'] },
    { method: 'GET', path: '/api/me/status', actors: ['teacher', 'schoolAdmin', 'platform'] },
    { method: 'POST', path: '/api/content/exclusions', data: { branchId: a.branchId, contentItemId: contentId, excluded: true }, actors: ['studentActive'] },
    { method: 'DELETE', path: `/api/content/${contentId}`, actors: ['studentActive'] },
  ];
};

// Positive smoke: the right role gets 200, so the 403s above are not just a broken endpoint.
const ALLOWED: { who: Who; path: string }[] = [
  { who: 'platform', path: '/api/platform/schools' },
  { who: 'schoolAdmin', path: '/api/school/students' },
  { who: 'schoolAdmin', path: '/api/school/enrollment' },
  { who: 'teacher', path: '/api/teacher/progress?sectionId=SECTION&subjectId=SUBJECT' },
  { who: 'studentActive', path: '/api/me/status' },
];

function envelopeCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string } };
    return parsed.error?.code;
  } catch {
    return undefined;
  }
}

type PW = { request: { newContext(o?: { baseURL?: string }): Promise<APIRequestContext> } };

async function apiContext(pw: PW, baseURL: string | undefined, c?: Creds): Promise<APIRequestContext> {
  const ctx = await pw.request.newContext({ baseURL });
  if (c) {
    const r = await ctx.post('/api/auth/login', { data: c });
    expect(r.status(), `API login ${c.username}`).toBe(200);
  }
  return ctx;
}

test.describe('API authorization and tenant isolation', () => {
  test.setTimeout(420_000);

  test('anonymous requests to every gated /api route get 401 UNAUTHENTICATED', async ({ playwright, baseURL }) => {
    const anon = await apiContext(playwright as unknown as PW, baseURL);
    try {
      for (const r of ANON_GATED) {
        const res = await anon.fetch(r.path, { method: r.method, data: r.data });
        const body = await res.text();
        const where = `anon ${r.method} ${r.path}`;
        expect.soft(res.status(), where).toBe(401);
        expect.soft(envelopeCode(body), `${where}: envelope code`).toBe('UNAUTHENTICATED');
        expect.soft(LEAK.test(body), `${where}: body leaks internals`).toBe(false);
      }
    } finally {
      await anon.dispose();
    }
  });

  test('public API routes stay reachable without a session', async ({ playwright, baseURL }) => {
    const anon = await apiContext(playwright as unknown as PW, baseURL);
    try {
      const res = await anon.get('/api/plans');
      expect.soft(res.status(), 'anon GET /api/plans').toBe(200);
      const body = await res.json();
      expect.soft(Array.isArray(body.plans), 'plans is a list').toBe(true);
    } finally {
      await anon.dispose();
    }
  });

  test('wrong-role requests get 403 FORBIDDEN, and the right role gets 200', async ({ page, playwright, baseURL }) => {
    test.setTimeout(420_000);
    const w = await createWorld();
    // A real, existing school A content item, so the role check (not a not-found lookup) decides the response.
    const contentId = await insertContentItem(w.seed.a.schoolId, w.seed.a.subjectId, w.seed.a.schoolAdmin.userId!, 'School A Probe Book');
    const probes = WRONG_ROLE(w, contentId);
    const contexts = new Map<Who, APIRequestContext>();
    const ctxFor = async (who: Who) => {
      if (!contexts.has(who)) {
        const c = who === 'studentActive' ? w.creds.studentActive : w.creds[who as Exclude<Who, 'anon'>];
        contexts.set(who, await apiContext(playwright as unknown as PW, baseURL, c));
      }
      return contexts.get(who)!;
    };
    try {
      for (const p of probes) {
        for (const who of p.actors) {
          const ctx = await ctxFor(who);
          const res = await ctx.fetch(p.path, { method: p.method, data: p.data });
          const body = await res.text();
          const where = `${who} ${p.method} ${p.path}`;
          expect.soft(res.status(), where).toBe(403);
          expect.soft(envelopeCode(body), `${where}: envelope code`).toBe('FORBIDDEN');
          expect.soft(LEAK.test(body), `${where}: body leaks internals`).toBe(false);
        }
      }
      const a = w.seed.a;
      for (const al of ALLOWED) {
        const ctx = await ctxFor(al.who);
        const path = al.path.replace('SECTION', a.sectionId).replace('SUBJECT', a.subjectId);
        const res = await ctx.get(path);
        expect.soft(res.status(), `${al.who} GET ${path} (allowed)`).toBe(200);
      }
    } finally {
      for (const c of contexts.values()) await c.dispose();
    }
    void page;
  });

  test('school A admin gets 404 for every school B id, and B data never leaks', async ({ playwright, baseURL }) => {
    test.setTimeout(420_000);
    const w = await createWorld();
    const { seed } = w;
    const b = seed.b;

    // School B fixtures, inserted directly in platform context like the repo's test helpers do.
    await withPlatform((tx) =>
      tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, b.studentId)),
    );
    await seedSkills();
    const [content] = await withPlatform((tx) =>
      tx
        .insert(contentItems)
        .values({
          schoolId: b.schoolId,
          grade: 8,
          subjectId: b.subjectId,
          kind: 'book',
          scope: 'school',
          title: 'School B Secret Book',
          fileKey: `${b.schoolId}/tenant-b.pdf`,
          uploadedBy: b.schoolAdmin.userId!,
          ingestStatus: 'ready',
          sizeBytes: 1000,
        })
        .returning({ id: contentItems.id }),
    );
    const [skill] = await withPlatform((tx) =>
      tx
        .insert(skills)
        .values({ key: 'tenant_probe_generator', name: 'tenant_probe_generator', kind: 'generator', instructions: 'fixture' })
        .returning({ id: skills.id }),
    );
    const [artifact] = await withPlatform((tx) =>
      tx
        .insert(artifacts)
        .values({
          schoolId: b.schoolId,
          studentId: b.studentId,
          skillId: skill.id,
          type: 'practice_test',
          subjectId: b.subjectId,
          status: 'ready',
          params: { chapterTitles: {} },
          content: { questions: [] },
        })
        .returning({ id: artifacts.id }),
    );
    const [attempt] = await withPlatform((tx) =>
      tx
        .insert(attempts)
        .values({ schoolId: b.schoolId, artifactId: artifact.id, studentId: b.studentId, status: 'in_progress' })
        .returning({ id: attempts.id }),
    );

    const bDbCreds = w.bStudent;
    const bStudentCtx = await apiContext(playwright as unknown as PW, baseURL, bDbCreds);
    let convId = '';
    try {
      const r = await bStudentCtx.post('/api/tutor/conversations', { data: { skillKey: 'socratic' } });
      expect.soft(r.status(), 'school B student creates a conversation (fixture)').toBe(201);
      convId = ((await r.json()) as { id: string }).id;
    } finally {
      await bStudentCtx.dispose();
    }

    const adminCtx = await apiContext(playwright as unknown as PW, baseURL, w.creds.schoolAdmin);
    try {
      const itemProbes: Req[] = [
        { method: 'POST', path: `/api/school/students/${b.studentId}/invite` },
        { method: 'POST', path: `/api/school/students/${b.studentId}/password`, data: { password: 'Another-pass-123' } },
        { method: 'POST', path: `/api/school/students/${b.studentId}/remove` },
        { method: 'POST', path: `/api/school/branches/${b.branchId}/code`, data: { action: 'disable' } },
        { method: 'POST', path: '/api/school/sections', data: { branchId: b.branchId, grade: 8, name: 'Probe B' } },
        { method: 'POST', path: '/api/school/assignments', data: { teacherId: b.teacherId, sectionId: b.sectionId, subjectId: b.subjectId } },
        { method: 'GET', path: `/api/teacher/progress?sectionId=${b.sectionId}&subjectId=${b.subjectId}` },
        { method: 'POST', path: '/api/content/exclusions', data: { branchId: b.branchId, contentItemId: content.id, excluded: true } },
        { method: 'DELETE', path: `/api/content/${content.id}` },
        { method: 'POST', path: `/api/content/${content.id}/retry` },
        { method: 'GET', path: `/api/tutor/conversations/${convId}/messages` },
        { method: 'GET', path: `/api/study/artifacts/${artifact.id}` },
        { method: 'GET', path: `/api/study/attempts/${attempt.id}` },
        { method: 'PUT', path: `/api/study/attempts/${attempt.id}/answers`, data: { answers: {} } },
        { method: 'POST', path: `/api/study/attempts/${attempt.id}/submit` },
      ];
      for (const p of itemProbes) {
        const res = await adminCtx.fetch(p.path, { method: p.method, data: p.data });
        const body = await res.text();
        const where = `school A admin ${p.method} ${p.path}`;
        expect.soft(res.status(), where).toBe(404);
        expect.soft(LEAK.test(body), `${where}: body leaks internals`).toBe(false);
        expect.soft(body.includes(b.schoolId) || body.includes(content.id) || body.includes(artifact.id), `${where}: body contains school B ids`).toBe(false);
      }

      // List and filter endpoints: school A's admin must never see school B rows, whatever the query says.
      const bUsername = bDbCreds.username;
      const bIds = [b.schoolId, b.studentId, b.teacherId, b.sectionId, b.branchId, content.id, artifact.id, convId, 'School B Secret Book', bUsername];
      const listProbes = [
        `/api/school/students?schoolId=${b.schoolId}`,
        `/api/school/students?branchId=${b.branchId}`,
        `/api/school/enrollment?schoolId=${b.schoolId}`,
        '/api/school/students',
        '/api/school/enrollment',
        '/api/content',
        '/api/study/artifacts',
        '/api/tutor/conversations',
      ];
      for (const path of listProbes) {
        const res = await adminCtx.get(path);
        const body = await res.text();
        const where = `school A admin GET ${path}`;
        expect.soft(res.status() < 500, `${where}: status below 500 (got ${res.status()})`).toBe(true);
        const leaked = bIds.filter((id) => body.includes(id));
        expect.soft(leaked, `${where}: leaks school B data`).toEqual([]);
        expect.soft(LEAK.test(body), `${where}: body leaks internals`).toBe(false);
      }
      // A school A student (a role that can use study and tutor) must get 404 for school B's study and tutor rows.
      const aStudentCtx = await apiContext(playwright as unknown as PW, baseURL, w.creds.studentActive);
      try {
        const studentProbes: Req[] = [
          { method: 'GET', path: `/api/study/artifacts/${artifact.id}` },
          { method: 'GET', path: `/api/study/attempts/${attempt.id}` },
          { method: 'PUT', path: `/api/study/attempts/${attempt.id}/answers`, data: { answers: {} } },
          { method: 'POST', path: `/api/study/attempts/${attempt.id}/submit` },
          { method: 'GET', path: `/api/tutor/conversations/${convId}/messages` },
        ];
        for (const p of studentProbes) {
          const res = await aStudentCtx.fetch(p.path, { method: p.method, data: p.data });
          const body = await res.text();
          const where = `school A student ${p.method} ${p.path}`;
          expect.soft(res.status(), where).toBe(404);
          expect.soft(LEAK.test(body), `${where}: body leaks internals`).toBe(false);
          expect.soft(body.includes(b.schoolId) || body.includes(artifact.id) || body.includes(attempt.id), `${where}: body contains school B ids`).toBe(false);
        }
      } finally {
        await aStudentCtx.dispose();
      }
    } finally {
      await adminCtx.dispose();
    }
  });

  test('error responses use the { error: { code, message } } envelope and never leak internals', async ({ playwright, baseURL }) => {
    test.setTimeout(300_000);
    const w = await createWorld();
    const admin = await apiContext(playwright as unknown as PW, baseURL, w.creds.schoolAdmin);
    try {
      const badJson = await admin.fetch('/api/school/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        data: '{"branchId": ',
      });
      const badJsonBody = await badJson.text();
      expect.soft(badJson.status(), 'malformed JSON body').toBe(400);
      expect.soft(envelopeCode(badJsonBody), 'malformed JSON envelope code').toBe('VALIDATION');
      expect.soft(LEAK.test(badJsonBody), 'malformed JSON body leaks internals').toBe(false);

      const wrongType = await admin.fetch('/api/school/students', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        data: '{}',
      });
      const wrongTypeBody = await wrongType.text();
      expect.soft(wrongType.status(), 'non-JSON content type').toBe(400);
      expect.soft(envelopeCode(wrongTypeBody), 'non-JSON content type envelope code').toBe('VALIDATION');

      const badShape = await admin.post('/api/school/sections', { data: { branchId: 1, grade: 'eight' } });
      const badShapeBody = await badShape.text();
      expect.soft(badShape.status(), 'wrong field types').toBe(400);
      expect.soft(envelopeCode(badShapeBody), 'wrong field types envelope code').toBe('VALIDATION');

      const unknownApi = await admin.get('/api/does-not-exist');
      const unknownApiBody = await unknownApi.text();
      expect.soft(unknownApi.status(), 'unknown API route').toBe(404);
      expect.soft(LEAK.test(unknownApiBody), 'unknown API route body leaks internals').toBe(false);

      const unknownPage = await admin.get('/no-such-page-for-probing');
      const unknownPageBody = await unknownPage.text();
      expect.soft(unknownPage.status(), 'unknown page route').toBe(404);
      expect.soft(LEAK.test(unknownPageBody), 'unknown page body leaks internals').toBe(false);
    } finally {
      await admin.dispose();
    }
  });
});

// ---------- session, cookies, logout ----------

test.describe('session and logout', () => {
  test.setTimeout(300_000);

  test('the session cookie is HttpOnly and SameSite=Lax', async ({ page }) => {
    const w = await createWorld();
    await loginAs(page, w.creds.teacher);
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === 'sid');
    expect.soft(sid, 'sid cookie is set after login').toBeTruthy();
    expect.soft(sid?.httpOnly, 'sid is HttpOnly').toBe(true);
    expect.soft(sid?.sameSite, 'sid SameSite').toBe('Lax');
    expect.soft(sid?.path, 'sid path').toBe('/');
  });

  test('a tampered session cookie is treated as anonymous (page redirect and API 401)', async ({ page, baseURL }) => {
    const w = await createWorld();
    const probe = watch(page);
    await loginAs(page, w.creds.teacher);
    await page.context().addCookies([{ name: 'sid', value: 'tampered-session-token-value', url: baseURL! }]);

    for (const route of ['/teacher', '/learn', '/school', '/platform']) {
      const obs = await observe(page, probe, route);
      expect.soft(obs.pathname, `tampered cookie: ${route}`).toBe('/login');
      await inspect(page, probe, `tampered cookie ${route}`, obs.status);
    }
    const api = await page.request.get('/api/me');
    expect.soft(api.status(), 'tampered cookie: GET /api/me').toBe(401);
    expect.soft(envelopeCode(await api.text()), 'tampered cookie: envelope code').toBe('UNAUTHENTICATED');
  });

  test('a removed session cookie is treated as anonymous', async ({ page }) => {
    const w = await createWorld();
    const probe = watch(page);
    await loginAs(page, w.creds.schoolAdmin);
    await page.context().clearCookies();
    const obs = await observe(page, probe, '/school');
    expect.soft(obs.pathname, 'removed cookie: /school').toBe('/login');
    await inspect(page, probe, 'removed cookie /school', obs.status);
    const api = await page.request.get('/api/me');
    expect.soft(api.status(), 'removed cookie: GET /api/me').toBe(401);
  });

  test('after logout, protected pages (direct visit and back button) redirect to /login', async ({ page, baseURL }) => {
    const w = await createWorld();
    const probe = watch(page);
    await loginAs(page, w.creds.teacher);
    await page.goto('/teacher');
    const oldSid = (await page.context().cookies()).find((c) => c.name === 'sid')?.value;
    expect.soft(oldSid, 'session cookie before logout').toBeTruthy();

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL((u) => u.pathname === '/login', { timeout: 30_000 });

    // Direct visit after logout.
    const direct = await observe(page, probe, '/teacher');
    expect.soft(new URL(page.url()).pathname, 'direct visit after logout').toBe('/login');
    await inspect(page, probe, 'after logout direct /teacher', direct.status);

    // Back button: the browser returns to the protected page, which must not show content.
    await page.goBack();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    const backPath = new URL(page.url()).pathname;
    const backShowsTeacher = await page.getByRole('heading', { name: 'Teacher', exact: true }).count();
    expect.soft(backPath === '/login' && backShowsTeacher === 0, `back button after logout: landed on ${backPath}, teacher heading visible=${backShowsTeacher > 0}`).toBe(true);

    // The old session token must be revoked server-side, not just cleared in the browser.
    const apiCtx = await page.context().request.get('/api/me', { headers: { cookie: `sid=${oldSid}` } });
    expect.soft(apiCtx.status(), 'old session token after logout').toBe(401);
    void baseURL;
  });
});

// ---------- browser: responsive smoke for the public login page ----------

test('login page has no horizontal scroll at 390px or 1280px and one labelled form', async ({ page }) => {
  await createWorld();
  const probe = watch(page);
  const obs = await observe(page, probe, '/login');
  await inspect(page, probe, '/login (anonymous)', obs.status);
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});
