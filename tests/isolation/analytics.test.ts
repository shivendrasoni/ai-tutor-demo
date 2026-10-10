/**
 * Cross-school isolation for analytics and platform views. Every case acts as School A's actors and targets
 * School B ids; each must reject or return no B data, and B's flag must stay open. School B has real data
 * (students in every status, messages with decisions, usage_daily, graded attempts with by_chapter, a flagged
 * message) so a leak would surface.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { conversations, memberships, messages, studentProfiles, usageDaily, users } from '@/db/schema';
import {
  costSummary, enrollmentSummary, getFlaggedConversation, listBranches, listFlagged, listSchools, listTeacherAssignments,
  markReviewed, platformOverview, routingStats, sectionProgress, studentUsage,
} from '@/modules/analytics';
import { createSession } from '@/modules/tenancy';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb } from '../helpers/db';
import {
  insertChapter, insertGradedAttempt, insertMessage, insertUsageDaily, seedAnalyticsWorld, type World,
} from '../helpers/analytics-seed';

import * as enrollmentRoute from '@/app/api/school/enrollment/route';
import * as studentsRoute from '@/app/api/school/students/route';
import * as progressRoute from '@/app/api/teacher/progress/route';
import * as usageRoute from '@/app/api/teacher/usage/route';
import * as costsRoute from '@/app/api/platform/costs/route';
import * as routingRoute from '@/app/api/platform/routing/route';
import * as flagsRoute from '@/app/api/platform/flags/route';
import * as schoolsRoute from '@/app/api/platform/schools/route';
import * as reviewRoute from '@/app/api/platform/flags/[messageId]/review/route';

let w: World;
let bIds: string[]; // every identifier / secret that belongs to School B
let bStudentIds: string[];
let bChapterId: string;
let bFlagged: string;

const codeOf = (p: Promise<unknown>) => p.then(() => 'RESOLVED', (e) => (e as { code?: string }).code ?? 'ERROR');
const bFlagReviewedAt = async () =>
  (await withPlatform((tx) => tx.select({ r: messages.reviewedAt }).from(messages).where(eq(messages.id, bFlagged)))).at(0)?.r;

beforeAll(async () => {
  await resetDb();
  const world = await seedAnalyticsWorld();
  w = world;
  const A = w.a;
  const B = w.b;
  const now = new Date();

  // School B: students in the remaining statuses.
  await withPlatform(async (tx) => {
    for (const [status, username] of [['lapsed', 'b_lapsed'], ['removed', 'b_removed']] as const) {
      const [u] = await tx.insert(users).values({ username, name: `B ${username}`, passwordHash: 'x' }).returning();
      await tx.insert(memberships).values({ userId: u.id, schoolId: B.schoolId, branchId: B.branchId, role: 'student' });
      await tx.insert(studentProfiles).values({
        userId: u.id, schoolId: B.schoolId, branchId: B.branchId, grade: 8, sectionId: B.sectionId, status,
        parentName: 'P', parentPhone: '9999999999',
      });
    }
  });

  // School B: tutoring traffic, usage, graded attempts, flagged message. School A gets the same shapes.
  for (const s of [A, B]) {
    const student = s.studentId;
    await insertMessage({ schoolId: s.schoolId, studentId: student, role: 'user', createdAt: now, subjectId: s.subjectId, content: `SECRET-${s.schoolId}` });
    await insertMessage({
      schoolId: s.schoolId, studentId: student, role: 'assistant', createdAt: now, subjectId: s.subjectId,
      decisions: { tier: 'advanced', deciderProvider: 'llm', deciderFellBack: false }, model: 'm', tokensIn: 100, tokensOut: 50, cost: 1.5,
    });
    const flaggedId = await insertMessage({
      schoolId: s.schoolId, studentId: student, role: 'assistant', createdAt: now, subjectId: s.subjectId,
      content: `FLAGGED-${s.schoolId}`, flagged: true, flagReason: 'unsafe', cost: 0.5,
    });
    if (s === B) bFlagged = flaggedId;
    await insertUsageDaily({ schoolId: s.schoolId, studentId: student, date: now.toISOString().slice(0, 10), tokens: 150, cost: 2 });
    const { chapterId } = await insertChapter({ schoolId: s.schoolId, branchId: s.branchId, sectionId: s.sectionId, subjectId: s.subjectId, grade: 8, title: `Chap-${s.schoolId}` });
    await insertGradedAttempt({ schoolId: s.schoolId, studentId: student, subjectId: s.subjectId, byChapter: { [chapterId]: { scored: 1, max: 4 } } });
    if (s === B) bChapterId = chapterId;
  }

  const bStudents = await withPlatform((tx) => tx.select({ id: studentProfiles.userId }).from(studentProfiles).where(eq(studentProfiles.schoolId, B.schoolId)));
  bStudentIds = bStudents.map((r) => r.id);
  bIds = [
    B.schoolId, B.branchId, B.code, B.sectionId, B.subjectId, B.teacherId, bChapterId, bFlagged,
    B.schoolAdmin.userId, B.branchAdmin.userId, ...bStudentIds, 'Branch B', 'School B', `SECRET-${B.schoolId}`, `FLAGGED-${B.schoolId}`, `Chap-${B.schoolId}`,
  ];
});
afterAll(closeDb);

const flagged = () => bFlagged;
const leaks = (v: unknown) => {
  const s = JSON.stringify(v);
  return bIds.filter((id) => s.includes(id));
};
type Key = 'schoolAdmin' | 'branchAdmin' | 'teacher' | 'student';
const aActors = (): [Key, Actor][] => (['schoolAdmin', 'branchAdmin', 'teacher', 'student'] as Key[]).map((k) => [k, w.a[k]]);
const SAFE = ['FORBIDDEN', 'NOT_FOUND'];

/** Rejects with FORBIDDEN/NOT_FOUND, or resolves with no B data. */
async function expectSafe(call: () => Promise<unknown>) {
  const out = await call().then(
    (value) => ({ value }),
    (e: { code?: string }) => ({ code: e.code }),
  );
  if ('code' in out) expect(SAFE).toContain(out.code);
  else expect(leaks(out.value)).toEqual([]);
}
const expectDenied = async (call: () => Promise<unknown>, codes = SAFE) => {
  const code = await codeOf(call());
  expect(codes).toContain(code);
};

it('seed sanity: B really holds data a leak would surface', async () => {
  const platform = w.platform;
  const enr = await enrollmentSummary(platform, { schoolId: w.b.schoolId });
  expect(enr.reduce((n, r) => n + r.active + r.lapsed + r.removed + r.pending, 0)).toBeGreaterThanOrEqual(6);
  expect(enr.some((r) => r.lapsed > 0) && enr.some((r) => r.removed > 0)).toBe(true);
  expect((await listFlagged(platform, { status: 'open' })).map((r) => r.messageId ?? (r as { id?: string }).id)).toContain(flagged());
  expect((await costSummary(platform, { days: 7 })).bySchool.find((r) => r.schoolId === w.b.schoolId)?.cost).toBeGreaterThan(0);
});

describe('school-scoped analytics, A actors with B ids', () => {
  it('enrollmentSummary: schoolId B is FORBIDDEN for school_admin; no filter returns only A branches', async () => {
    await expectDenied(() => enrollmentSummary(w.a.schoolAdmin, { schoolId: w.b.schoolId }), ['FORBIDDEN']);
    await expectDenied(() => enrollmentSummary(w.a.branchAdmin, { schoolId: w.b.schoolId }), ['FORBIDDEN']);
    await expectDenied(() => enrollmentSummary(w.a.teacher, { schoolId: w.b.schoolId }), ['FORBIDDEN']);
    await expectDenied(() => enrollmentSummary(w.a.student, { schoolId: w.b.schoolId }), ['FORBIDDEN']);
    const own = await enrollmentSummary(w.a.schoolAdmin, {});
    expect(own.length).toBeGreaterThan(0);
    expect(leaks(own)).toEqual([]);
    const branchOnly = await enrollmentSummary(w.a.branchAdmin, {});
    expect(branchOnly.every((r) => r.branchId === w.a.branchId)).toBe(true);
    expect(leaks(branchOnly)).toEqual([]);
  });

  it('studentUsage and sectionProgress with B section/subject ids never return B data', async () => {
    for (const [, actor] of aActors()) {
      await expectSafe(() => studentUsage(actor, { sectionId: w.b.sectionId }));
      await expectSafe(() => studentUsage(actor, { subjectId: w.b.subjectId }));
      await expectSafe(() => studentUsage(actor, { sectionId: w.b.sectionId, subjectId: w.b.subjectId }));
      await expectSafe(() => sectionProgress(actor, { sectionId: w.b.sectionId, subjectId: w.b.subjectId }));
      await expectSafe(() => sectionProgress(actor, { sectionId: w.b.sectionId, subjectId: w.a.subjectId }));
      await expectSafe(() => sectionProgress(actor, { sectionId: w.a.sectionId, subjectId: w.b.subjectId }));
    }
    for (const k of ['schoolAdmin', 'branchAdmin', 'teacher'] as const) {
      await expectDenied(() => studentUsage(w.a[k], { sectionId: w.b.sectionId }));
      await expectDenied(() => sectionProgress(w.a[k], { sectionId: w.b.sectionId, subjectId: w.b.subjectId }));
    }
  });

  it('studentUsage without filters and with A filters never returns a B student id', async () => {
    for (const k of ['schoolAdmin', 'branchAdmin', 'teacher'] as const) {
      const rows = await studentUsage(w.a[k], {}).catch((e: { code?: string }) => {
        if (e.code !== 'FORBIDDEN') throw e;
        return [];
      });
      expect(leaks(rows)).toEqual([]);
    }
    const adminRows = await studentUsage(w.a.schoolAdmin, {});
    expect(adminRows.length).toBeGreaterThan(0);
    expect(leaks(await studentUsage(w.a.schoolAdmin, { sectionId: w.a.sectionId }))).toEqual([]);
  });

  it('sectionProgress on A data does not blend in B attempts', async () => {
    const p = await sectionProgress(w.a.teacher, { sectionId: w.a.sectionId, subjectId: w.a.subjectId });
    expect(leaks(p)).toEqual([]);
  });

  it('listBranches never includes B branches, sections or codes', async () => {
    for (const k of ['schoolAdmin', 'branchAdmin'] as const) {
      const list = await listBranches(w.a[k]);
      expect(list.length).toBeGreaterThan(0);
      expect(leaks(list)).toEqual([]);
    }
    await expectDenied(() => listBranches(w.a.teacher), ['FORBIDDEN']);
    await expectDenied(() => listBranches(w.a.student), ['FORBIDDEN']);
  });

  it('listTeacherAssignments returns only the teacher’s own A assignments', async () => {
    const rows = await listTeacherAssignments(w.a.teacher);
    expect(rows.length).toBeGreaterThan(0);
    expect(leaks(rows)).toEqual([]);
    await expectDenied(() => listTeacherAssignments(w.a.schoolAdmin), ['FORBIDDEN']);
    await expectDenied(() => listTeacherAssignments(w.a.student), ['FORBIDDEN']);
  });
});

describe('platform-only functions', () => {
  it.each(['schoolAdmin', 'branchAdmin', 'teacher', 'student'] as const)('A %s is FORBIDDEN on every platform function with B ids', async (k) => {
    const actor = w.a[k];
    const calls: (() => Promise<unknown>)[] = [
      () => costSummary(actor, { days: 30 }),
      () => routingStats(actor, { days: 30 }),
      () => listFlagged(actor, { status: 'open' }),
      () => listFlagged(actor, { status: 'reviewed' }),
      () => getFlaggedConversation(actor, flagged()),
      () => markReviewed(actor, flagged()),
      () => listSchools(actor),
      () => platformOverview(actor),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await bFlagReviewedAt()).toBeNull();
  });

  it('control: the platform admin does see B’s flag (so the denials above are not vacuous)', async () => {
    const conv = await getFlaggedConversation(w.platform, flagged());
    expect(conv.flaggedMessageId).toBe(flagged());
    expect(JSON.stringify(conv)).toContain(`FLAGGED-${w.b.schoolId}`);
  });
});

describe('raw tenant reads', () => {
  it('withTenant(A) over messages, usage_daily, conversations returns only A rows', async () => {
    for (const t of [messages, usageDaily, conversations]) {
      const rows = await withTenant(w.a.schoolId, (tx) => tx.select().from(t));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => (r as { schoolId: string }).schoolId === w.a.schoolId)).toBe(true);
    }
  });
});

describe('dashboard API routes with B ids', () => {
  const sid = async (userId: string) => `sid=${await createSession(userId)}`;
  const get = (path: string, cookie: string) =>
    new Request(`http://localhost${path}`, { headers: { cookie } });
  const clean = async (res: Response) => {
    expect([403, 404]).toContain(res.status);
    expect(leaks(await res.text())).toEqual([]);
  };

  it('school/enrollment and school/students: schoolId or branchId of B is rejected', async () => {
    for (const k of ['schoolAdmin', 'branchAdmin'] as const) {
      const c = await sid(w.a[k].userId);
      await clean(await enrollmentRoute.GET(get(`/x?schoolId=${w.b.schoolId}`, c)));
      expect((await enrollmentRoute.GET(get(`/x?branchId=${w.b.branchId}`, c))).status).toBe(403);
      await clean(await studentsRoute.GET(get(`/x?schoolId=${w.b.schoolId}`, c)));
      expect((await studentsRoute.GET(get(`/x?branchId=${w.b.branchId}`, c))).status).toBe(403);
    }
    const own = await enrollmentRoute.GET(get('/x', await sid(w.a.schoolAdmin.userId)));
    expect(own.status).toBe(200);
    expect(leaks(await own.text())).toEqual([]);
  });

  it('branch_admin cannot widen to another branch of the same school', async () => {
    // enrollmentSummary has no branch argument: it must scope a branch_admin to their own branch, never widen.
    await expectDenied(() => enrollmentSummary(w.a.branchAdmin, { schoolId: w.a.schoolId }), ['FORBIDDEN']);
    const rows = await enrollmentSummary(w.a.branchAdmin, {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branchId === w.a.branchId)).toBe(true);
    const c = await sid(w.a.branchAdmin.userId);
    expect((await enrollmentRoute.GET(get(`/x?branchId=${w.aBranch2Id}`, c))).status).toBe(403);
    expect((await studentsRoute.GET(get(`/x?branchId=${w.aBranch2Id}`, c))).status).toBe(403);
  });

  it('platform routes are 403 for A staff and B’s flag stays open', async () => {
    const post = (path: string, cookie: string) => new Request(`http://localhost${path}`, { method: 'POST', headers: { cookie } });
    for (const k of ['schoolAdmin', 'branchAdmin', 'teacher'] as const) {
      const c = await sid(w.a[k].userId);
      for (const [h, url] of [
        [costsRoute.GET, '/x?days=30'], [routingRoute.GET, '/x?days=30'], [flagsRoute.GET, '/x'], [schoolsRoute.GET, '/x'],
      ] as const) expect((await h(get(url, c))).status).toBe(403);
      const res = await reviewRoute.POST(post('/x', c), { params: Promise.resolve({ messageId: flagged() }) });
      expect(res.status).toBe(403);
    }
    expect(await bFlagReviewedAt()).toBeNull();
  });

  it('teacher/progress and teacher/usage with B ids are rejected for A staff', async () => {
    const qs = `sectionId=${w.b.sectionId}&subjectId=${w.b.subjectId}`;
    for (const k of ['schoolAdmin', 'branchAdmin', 'teacher'] as const) {
      const c = await sid(w.a[k].userId);
      await clean(await progressRoute.GET(get(`/x?${qs}`, c)));
      await clean(await usageRoute.GET(get(`/x?${qs}`, c)));
    }
    const ok = await progressRoute.GET(get(`/x?sectionId=${w.a.sectionId}&subjectId=${w.a.subjectId}`, await sid(w.a.teacher.userId)));
    expect(ok.status).toBe(200);
    expect(leaks(await ok.text())).toEqual([]);
  });
});
