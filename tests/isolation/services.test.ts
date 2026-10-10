/**
 * Cross-school isolation suite. Every case acts as School A's actors and targets School B ids.
 * Each must reject (FORBIDDEN / NOT_FOUND, or VALIDATION where noted) or return no B data, and for
 * mutating calls B's full tenant data snapshot (via withPlatform, bypassing RLS) must be unchanged.
 */
import { asc, eq, getTableName, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import {
  artifacts, attempts, branches, chunks, contentChapters, contentExclusions, contentItems, conversations, invites, messages, payments, schools, sections, skills, studentProfiles, subjects, teacherAssignments,
  tenantTables, usageDaily, users,
} from '@/db/schema';
import {
  listPendingSubscriptions, listStudents, manualAddStudent, recordPayment, reissueInvite, removeStudent, studentStatus,
} from '@/modules/enrollment';
import {
  assignTeacher, createBranch, createSection, createStaffUser, createSubject, listSectionsForBranch,
  rotateBranchCode, setBranchCodeEnabled,
} from '@/modules/tenancy';
import { hashToken } from '@/modules/tenancy/auth/sessions';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
const DENIED = ['FORBIDDEN', 'NOT_FOUND'];
/** The Postgres SQLSTATE behind a rejected query (Drizzle wraps the driver error in `cause`). */
const pgCodeOf = (p: Promise<unknown>) =>
  p.then(() => 'ok', (e: { code?: string; cause?: { code?: string } }) => e.cause?.code ?? e.code ?? String(e));

type TenantTable = (typeof tenantTables)[number];
const name = (t: TenantTable) => getTableName(t);

/** Every tenant row (every tenant table) plus the schools row for `schoolId`, read with RLS bypassed. */
async function snapshot(schoolId: string): Promise<Record<string, unknown[]>> {
  return withPlatform(async (tx) => {
    const out: Record<string, unknown[]> = {};
    for (const T of tenantTables) {
      const res = await tx.execute(
        sql`select * from ${T} where school_id = ${schoolId} order by ${sql.raw('ctid')}`,
      );
      out[name(T)] = res.rows;
    }
    out.schools = (await tx.execute(sql`select * from schools where id = ${schoolId}`)).rows;
    return out;
  });
}

const userCount = async () =>
  (await withPlatform((tx) => tx.execute(sql`select count(*)::int as n from users`))).rows[0].n as number;

const studentInput = (branchId: string) => ({
  branchId, grade: 8, studentName: 'Intruder', parentName: 'P', parentPhone: '1234567890',
});

/** Asserts `p` is denied and nothing in School B (or the users table) changed. */
async function expectDeniedNoBChange(p: () => Promise<unknown>, allowed: string[] = DENIED) {
  const before = await snapshot(seed.b.schoolId);
  const usersBefore = await userCount();
  expect(allowed).toContain(await codeOf(p()));
  expect(await snapshot(seed.b.schoolId)).toEqual(before);
  expect(await userCount()).toBe(usersBefore);
}

const bProfile = async () =>
  (await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, seed.b.studentId))))[0];
const bBranch = async () =>
  (await withPlatform((tx) => tx.select().from(branches).where(eq(branches.id, seed.b.branchId))))[0];

describe('service-level isolation: School A actors vs School B ids', () => {
  it('listStudents for B branch/school returns no B data', async () => {
    const { a, b } = seed;
    const r = await listStudents(a.schoolAdmin, { branchId: b.branchId }).catch((e) => e.code as string);
    if (typeof r === 'string') expect(r).toBe('FORBIDDEN');
    else {
      expect(r).toEqual([]);
      expect(r.some((row) => row.branchId === b.branchId || row.userId === b.studentId)).toBe(false);
    }
    expect(await codeOf(listStudents(a.schoolAdmin, { schoolId: b.schoolId }))).toBe('FORBIDDEN');
    expect(await codeOf(listStudents(a.branchAdmin, { branchId: b.branchId }))).toBe('FORBIDDEN');
    // Unfiltered list for A contains only A's student.
    const own = await listStudents(a.schoolAdmin, {});
    expect(own.map((row) => row.userId)).toEqual([a.studentId]);
  });

  it('removeStudent(B student) rejects; B student stays pending_payment', async () => {
    await expectDeniedNoBChange(() => removeStudent(seed.a.schoolAdmin, seed.b.studentId));
    await expectDeniedNoBChange(() => removeStudent(seed.a.branchAdmin, seed.b.studentId));
    expect((await bProfile()).status).toBe('pending_payment');
  });

  it('rotateBranchCode / setBranchCodeEnabled on B branch reject; B code unchanged', async () => {
    const { a, b } = seed;
    await expectDeniedNoBChange(() => rotateBranchCode(a.schoolAdmin, b.branchId));
    await expectDeniedNoBChange(() => rotateBranchCode(a.branchAdmin, b.branchId));
    await expectDeniedNoBChange(() => setBranchCodeEnabled(a.schoolAdmin, b.branchId, false));
    await expectDeniedNoBChange(() => setBranchCodeEnabled(a.branchAdmin, b.branchId, false));
    const br = await bBranch();
    expect(br.signupCode).toBe(b.code);
    expect(br.signupCodeEnabled).toBe(true);
  });

  it('createSection in B branch rejects; B section count unchanged', async () => {
    const { a, b } = seed;
    await expectDeniedNoBChange(() => createSection(a.branchAdmin, { branchId: b.branchId, grade: 9, name: '9-X' }));
    await expectDeniedNoBChange(() => createSection(a.schoolAdmin, { branchId: b.branchId, grade: 9, name: '9-X' }));
    const n = await withPlatform((tx) => tx.select().from(sections).where(eq(sections.schoolId, b.schoolId)));
    expect(n).toHaveLength(1);
  });

  it('createStaffUser into B school rejects; no B membership or user created', async () => {
    const { a, b } = seed;
    const staff = { username: 'intruder_staff', password: 'long-enough-pw', name: 'Intruder' };
    await expectDeniedNoBChange(() =>
      createStaffUser(a.schoolAdmin, { schoolId: b.schoolId, branchId: null, role: 'school_admin', ...staff }),
    );
    await expectDeniedNoBChange(() =>
      createStaffUser(a.schoolAdmin, { schoolId: b.schoolId, branchId: b.branchId, role: 'teacher', ...staff }),
    );
    await expectDeniedNoBChange(() =>
      createStaffUser(a.branchAdmin, { schoolId: b.schoolId, branchId: b.branchId, role: 'teacher', ...staff }),
    );
    // Own school id but B's branch: RLS hides B's branch -> VALIDATION, nothing written.
    await expectDeniedNoBChange(
      () => createStaffUser(a.schoolAdmin, { schoolId: a.schoolId, branchId: b.branchId, role: 'teacher', ...staff }),
      ['VALIDATION'],
    );
    const u = await withPlatform((tx) => tx.select().from(users).where(eq(users.username, 'intruder_staff')));
    expect(u).toHaveLength(0);
  });

  it('assignTeacher onto B section (or with B teacher/subject) rejects; no teacher_assignments row', async () => {
    const { a, b } = seed;
    const countTA = async () => (await withPlatform((tx) => tx.select().from(teacherAssignments))).length;
    const before = await countTA();
    await expectDeniedNoBChange(() =>
      assignTeacher(a.schoolAdmin, { teacherId: a.teacherId, sectionId: b.sectionId, subjectId: a.subjectId }),
    );
    await expectDeniedNoBChange(() =>
      assignTeacher(a.branchAdmin, { teacherId: a.teacherId, sectionId: b.sectionId, subjectId: a.subjectId }),
    );
    // A's own section but B's subject / B's teacher: rejected as VALIDATION (not visible under A's tenant).
    await expectDeniedNoBChange(
      () => assignTeacher(a.schoolAdmin, { teacherId: a.teacherId, sectionId: a.sectionId, subjectId: b.subjectId }),
      ['VALIDATION'],
    );
    await expectDeniedNoBChange(
      () => assignTeacher(a.schoolAdmin, { teacherId: b.teacherId, sectionId: a.sectionId, subjectId: a.subjectId }),
      ['VALIDATION'],
    );
    expect(await countTA()).toBe(before);
  });

  it('manualAddStudent into B branch rejects; B student count unchanged', async () => {
    const { a, b } = seed;
    await expectDeniedNoBChange(() => manualAddStudent(a.schoolAdmin, studentInput(b.branchId)));
    await expectDeniedNoBChange(() => manualAddStudent(a.branchAdmin, studentInput(b.branchId)));
    // B's section id smuggled into an A-branch add: section isn't visible -> VALIDATION.
    await expectDeniedNoBChange(
      () => manualAddStudent(a.schoolAdmin, { ...studentInput(a.branchId), sectionId: b.sectionId }),
      ['VALIDATION'],
    );
    const n = await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.schoolId, b.schoolId)));
    expect(n).toHaveLength(1);
  });

  it('reissueInvite for a B student by A actors is denied and B invites are untouched', async () => {
    const { a, b } = seed;
    const { studentUserId } = await manualAddStudent(b.schoolAdmin, studentInput(b.branchId));
    const invitesOf = () => withPlatform((tx) => tx.select().from(invites).where(eq(invites.schoolId, b.schoolId)));
    const before = await invitesOf();
    for (const actor of [a.schoolAdmin, a.branchAdmin, a.teacher, a.student]) {
      expect(['NOT_FOUND', 'FORBIDDEN']).toContain(await codeOf(reissueInvite(actor, studentUserId)));
    }
    expect(await invitesOf()).toEqual(before);
  });

  it('recordPayment / listPendingSubscriptions as school admin are FORBIDDEN', async () => {
    const { a, b } = seed;
    await expectDeniedNoBChange(
      () => recordPayment(a.schoolAdmin, {
        subscriptionId: b.subscriptionId, amountMinor: 100, currency: 'INR', paidAt: new Date(),
      }),
      ['FORBIDDEN'],
    );
    await expectDeniedNoBChange(
      () => recordPayment(a.schoolAdmin, {
        subscriptionId: a.subscriptionId, amountMinor: 100, currency: 'INR', paidAt: new Date(),
      }),
      ['FORBIDDEN'],
    );
    expect(await codeOf(listPendingSubscriptions(a.schoolAdmin))).toBe('FORBIDDEN');
    expect(await codeOf(listPendingSubscriptions(a.branchAdmin))).toBe('FORBIDDEN');
    expect((await bProfile()).status).toBe('pending_payment');
    const bPayments = await withPlatform((tx) => tx.select().from(payments).where(eq(payments.schoolId, b.schoolId)));
    expect(bPayments).toHaveLength(0);
  });

  it('studentStatus(a.student) returns only A data', async () => {
    const { a, b, platform } = seed;
    // Make B distinguishable: B becomes active with a period end; A stays pending.
    await recordPayment(platform, {
      subscriptionId: b.subscriptionId, amountMinor: 49900, currency: 'INR', paidAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(await studentStatus(a.student)).toEqual({ status: 'pending_payment', planName: 'Monthly', periodEnd: null });
    expect((await studentStatus(b.student)).status).toBe('active');
  });

  it('createSubject / createBranch for B school are FORBIDDEN', async () => {
    const { a, b } = seed;
    await expectDeniedNoBChange(() => createSubject(a.schoolAdmin, { schoolId: b.schoolId, name: 'Physics' }), ['FORBIDDEN']);
    await expectDeniedNoBChange(() => createBranch(a.schoolAdmin, { schoolId: b.schoolId, name: 'Rogue' }), ['FORBIDDEN']);
    await expectDeniedNoBChange(() => createSubject(a.branchAdmin, { schoolId: b.schoolId, name: 'Physics' }), ['FORBIDDEN']);
  });

  it('listSectionsForBranch(A school, B branch) returns []', async () => {
    expect(await listSectionsForBranch(seed.a.schoolId, seed.b.branchId)).toEqual([]);
    expect(await listSectionsForBranch(seed.a.schoolId, seed.a.branchId)).toHaveLength(1);
  });

  it('teacher and student actors of A cannot manage B either', async () => {
    const { a, b } = seed;
    for (const actor of [a.teacher, a.student]) {
      await expectDeniedNoBChange(() => rotateBranchCode(actor, b.branchId));
      await expectDeniedNoBChange(() => removeStudent(actor, b.studentId));
      await expectDeniedNoBChange(() => manualAddStudent(actor, studentInput(b.branchId)));
      expect(await codeOf(listStudents(actor, { branchId: b.branchId }))).toBe('FORBIDDEN');
    }
  });
});

describe('branch-level isolation inside School A', () => {
  it('a.branchAdmin (branch A1) cannot act on branch A2', async () => {
    const { a, platform } = seed;
    const a2 = await createBranch(platform, { schoolId: a.schoolId, name: 'Branch A2' });
    const { studentUserId } = await manualAddStudent(a.schoolAdmin, studentInput(a2.id));
    const a2Snapshot = () => snapshot(a.schoolId);
    const before = await a2Snapshot();

    expect(await codeOf(manualAddStudent(a.branchAdmin, studentInput(a2.id)))).toBe('FORBIDDEN');
    expect(await codeOf(removeStudent(a.branchAdmin, studentUserId))).toBe('FORBIDDEN');
    expect(await codeOf(rotateBranchCode(a.branchAdmin, a2.id))).toBe('FORBIDDEN');
    expect(await codeOf(setBranchCodeEnabled(a.branchAdmin, a2.id, false))).toBe('FORBIDDEN');
    expect(await codeOf(createSection(a.branchAdmin, { branchId: a2.id, grade: 9, name: '9-X' }))).toBe('FORBIDDEN');
    expect(await codeOf(listStudents(a.branchAdmin, { branchId: a2.id }))).toBe('FORBIDDEN');

    expect(await a2Snapshot()).toEqual(before);
    const [row] = await withPlatform((tx) => tx.select().from(branches).where(eq(branches.id, a2.id)));
    expect(row.signupCode).toBe(a2.signupCode);
    expect(row.signupCodeEnabled).toBe(true);
    const [p] = await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, studentUserId)));
    expect(p.status).toBe('pending_payment');
  });
});

describe('raw RLS isolation over tenantTables', () => {
  /** Seeds a payment, an invite, content, tutor and study rows for each school so every tenant table has rows for both. */
  async function seedAllTables() {
    await withPlatform(async (tx) => {
      const [skill] = await tx.insert(skills).values({ key: 'iso', name: 'iso', kind: 'chat', instructions: 'i' }).returning();
      for (const s of [seed.a, seed.b]) {
        await tx.insert(payments).values({
          schoolId: s.schoolId, subscriptionId: s.subscriptionId, amountMinor: 100, currency: 'INR',
          method: 'manual_link', paidAt: new Date(), recordedBy: seed.platform.userId,
        });
        await tx.insert(invites).values({
          schoolId: s.schoolId, studentUserId: s.studentId, tokenHash: hashToken(`tok-${s.schoolId}`),
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        const [item] = await tx.insert(contentItems).values({
          schoolId: s.schoolId, grade: 8, subjectId: s.subjectId, kind: 'book', scope: 'school', title: 'Book',
          fileKey: `${s.schoolId}/b.pdf`, uploadedBy: seed.platform.userId, sizeBytes: 1,
        }).returning();
        const [chapter] = await tx.insert(contentChapters).values({
          schoolId: s.schoolId, contentItemId: item.id, ordinal: 1, title: 'Ch 1', pageStart: 1, pageEnd: 1,
        }).returning();
        await tx.insert(chunks).values({
          schoolId: s.schoolId, contentItemId: item.id, chapterId: chapter.id, ordinal: 1, pageStart: 1, pageEnd: 1,
          text: 't', tokenEstimate: 1,
        });
        await tx.insert(contentExclusions).values({ schoolId: s.schoolId, branchId: s.branchId, contentItemId: item.id });
        const [conv] = await tx.insert(conversations).values({ schoolId: s.schoolId, studentId: s.studentId, skillId: skill.id }).returning();
        await tx.insert(messages).values({ schoolId: s.schoolId, conversationId: conv.id, role: 'user', content: 'hi' });
        await tx.insert(usageDaily).values({ schoolId: s.schoolId, studentId: s.studentId, date: '2026-10-10', tokens: 1 });
        const [art] = await tx.insert(artifacts).values({
          schoolId: s.schoolId, studentId: s.studentId, skillId: skill.id, type: 'practice_test', subjectId: s.subjectId,
          status: 'ready',
        }).returning();
        await tx.insert(attempts).values({ schoolId: s.schoolId, artifactId: art.id, studentId: s.studentId, status: 'in_progress' });
      }
    });
  }

  it('every tenant table has rows for both schools (non-vacuous setup)', async () => {
    await seedAllTables();
    const [sa, sb] = [await snapshot(seed.a.schoolId), await snapshot(seed.b.schoolId)];
    for (const T of tenantTables) {
      expect(sa[name(T)].length, `${name(T)} A`).toBeGreaterThan(0);
      expect(sb[name(T)].length, `${name(T)} B`).toBeGreaterThan(0);
    }
  });

  it('withTenant(A) select over every tenant table returns only A rows (and all of them)', async () => {
    await seedAllTables();
    const expected = await snapshot(seed.a.schoolId);
    for (const T of tenantTables) {
      const rows = (await withTenant(seed.a.schoolId, (tx) => tx.select().from(T))) as { schoolId: string }[];
      expect(rows.length, name(T)).toBeGreaterThan(0);
      expect(rows.length, name(T)).toBe(expected[name(T)].length);
      expect(rows.every((r) => r.schoolId === seed.a.schoolId), name(T)).toBe(true);
    }
  });

  it('withTenant(A) UPDATE and DELETE targeting B rows affect 0 rows on every tenant table', async () => {
    await seedAllTables();
    const before = await snapshot(seed.b.schoolId);
    for (const T of tenantTables) {
      const upd = await withTenant(seed.a.schoolId, (tx) =>
        tx.execute(sql`update ${T} set school_id = school_id where school_id = ${seed.b.schoolId} returning 1`),
      );
      expect(upd.rows.length, `update ${name(T)}`).toBe(0);
      const updAll = await withTenant(seed.a.schoolId, (tx) =>
        tx.execute(sql`update ${T} set school_id = school_id returning school_id`),
      );
      expect(updAll.rows.every((r) => r.school_id === seed.a.schoolId), `update-all ${name(T)}`).toBe(true);
      const del = await withTenant(seed.a.schoolId, (tx) =>
        tx.execute(sql`delete from ${T} where school_id = ${seed.b.schoolId} returning 1`),
      );
      expect(del.rows.length, `delete ${name(T)}`).toBe(0);
    }
    // Moving an A row into B is rejected by the WITH CHECK clause.
    // 42501 = insufficient_privilege: "new row violates row-level security policy".
    expect(
      await pgCodeOf(
        withTenant(seed.a.schoolId, (tx) =>
          tx.update(subjects).set({ schoolId: seed.b.schoolId }).where(eq(subjects.schoolId, seed.a.schoolId)),
        ),
      ),
    ).toBe('42501');
    expect(await snapshot(seed.b.schoolId)).toEqual(before);
  });

  it('withTenant(A) INSERT of a B-keyed row is rejected', async () => {
    const r = await pgCodeOf(
      withTenant(seed.a.schoolId, (tx) => tx.insert(subjects).values({ schoolId: seed.b.schoolId, name: 'Rogue' })),
    );
    expect(r).toBe('42501');
  });

  it('schools under withTenant(A) shows only School A; B cannot be updated', async () => {
    const rows = await withTenant(seed.a.schoolId, (tx) => tx.select().from(schools).orderBy(asc(schools.id)));
    expect(rows.map((s) => s.id)).toEqual([seed.a.schoolId]);
    const upd = await withTenant(seed.a.schoolId, (tx) =>
      tx.update(schools).set({ name: 'Hacked' }).where(eq(schools.id, seed.b.schoolId)).returning({ id: schools.id }),
    );
    expect(upd).toHaveLength(0);
    const [b] = await withPlatform((tx) => tx.select().from(schools).where(eq(schools.id, seed.b.schoolId)));
    expect(b.name).toBe('School B');
  });
});
