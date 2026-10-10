import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { memberships, payments, sessions, studentProfiles, teacherAssignments, users } from '@/db/schema';
import { signupWithCode } from '@/modules/enrollment';
import { run } from '../../scripts/admin';
import { login } from '@/modules/tenancy';
import { createSession } from '@/modules/tenancy/auth/sessions';
import { resetDb, seedTwoSchools } from '../helpers/db';
import { recentPaidAt } from '../helpers/dates';
import { addInterval } from '@/modules/enrollment/periods';

beforeEach(resetDb);
afterAll(closeDb);

/** Runs the CLI in-process, capturing stdout/stderr lines. */
async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out, err, json: () => JSON.parse(out.at(-1) ?? 'null') };
}

describe('scripts/admin run()', () => {
  it('rejects an empty required flag with a usage error', async () => {
    const r = await cli('create-school', '--name', '', '--board', 'CBSE');
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('--name');
  });


  it('wires every command end-to-end and never prints passwords', async () => {
    const pa = await cli('create-platform-admin', '--username', 'Ops_Test', '--password', 'change-me-now', '--name', 'Ops');
    expect(pa.code).toBe(0);
    const { userId: opsId } = pa.json();
    const [ops] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, opsId)));
    expect(pa.json().username).toBe('ops_test');
    expect(ops.username).toBe('ops_test');
    expect(ops.isPlatformAdmin).toBe(true);
    expect(ops.passwordHash).toMatch(/^\$argon2id\$/);

    const school = await cli('create-school', '--name', 'Demo School', '--board', 'CBSE', '--as', 'ops_test');
    expect(school.code).toBe(0);
    const { schoolId } = school.json();
    // Without --as a synthetic platform actor is used.
    expect((await cli('create-school', '--name', 'Other', '--board', 'ICSE')).code).toBe(0);

    const branch = await cli('create-branch', '--school', schoolId, '--name', 'Main');
    expect(branch.code).toBe(0);
    const { branchId, signupCode } = branch.json();
    expect(signupCode).toMatch(/^[A-Z0-9]+$/);

    const plan = await cli('create-plan', '--name', 'Monthly', '--interval', 'monthly', '--price-minor', '49900', '--currency', 'inr');
    expect(plan.code).toBe(0);
    const { planId } = plan.json();

    const staff = await cli(
      'create-staff', '--school', schoolId, '--branch', branchId, '--role', 'teacher',
      '--username', 'teach_one', '--password', 'teacher-pass-1', '--name', 'Teacher One',
    );
    expect(staff.code).toBe(0);
    const [m] = await withPlatform((tx) => tx.select().from(memberships).where(eq(memberships.userId, staff.json().userId)));
    expect(m).toMatchObject({ schoolId, branchId, role: 'teacher' });

    const { subscriptionId, studentUserId } = await signupWithCode({
      code: signupCode, grade: 8, studentName: 'Kid', parentName: 'Parent', parentPhone: '9999999999',
      planId, username: 'kid_one', password: 'kid-pass-123',
    });

    const pending = await cli('pending');
    expect(pending.code).toBe(0);
    expect(pending.json()).toEqual([expect.objectContaining({ subscriptionId, studentName: 'Kid', planName: 'Monthly' })]);

    // record-payment requires --as.
    const noAs = await cli('record-payment', '--subscription', subscriptionId, '--amount-minor', '49900');
    expect(noAs.code).not.toBe(0);
    expect(noAs.err.join('\n')).toMatch(/--as/);

    const paidAt = recentPaidAt();
    const paid = await cli(
      'record-payment', '--subscription', subscriptionId, '--amount-minor', '49900',
      '--ref', 'UPI-1', '--paid-at', paidAt.toISOString(), '--as', 'ops_test',
    );
    expect(paid.code).toBe(0);
    expect(paid.json()).toEqual({ periodStart: paidAt.toISOString(), periodEnd: addInterval(paidAt, 'monthly').toISOString() });
    const [pay] = await withPlatform((tx) => tx.select().from(payments));
    expect(pay).toMatchObject({ recordedBy: opsId, externalRef: 'UPI-1', currency: 'INR', amountMinor: 49900 });
    const [p] = await withPlatform((tx) => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, studentUserId)));
    expect(p.status).toBe('active');
    expect((await cli('pending')).json()).toEqual([]);

    // The CLI cannot bypass the paid-at bounds or the duplicate-reference guard.
    const future = await cli(
      'record-payment', '--subscription', subscriptionId, '--amount-minor', '1',
      '--paid-at', new Date(Date.now() + 86_400_000).toISOString(), '--as', 'ops_test',
    );
    expect(future.code).toBe(1);
    expect(future.err.join('\n')).toMatch(/VALIDATION.*future/);
    const dupe = await cli(
      'record-payment', '--subscription', subscriptionId, '--amount-minor', '49900',
      '--ref', 'UPI-1', '--paid-at', recentPaidAt(0).toISOString(), '--as', 'ops_test',
    );
    expect(dupe.code).toBe(1);
    expect(dupe.err.join('\n')).toMatch(/duplicate_payment/);

    const all = [pa, school, branch, plan, staff, pending, paid].flatMap((r) => [...r.out, ...r.err]).join('\n');
    expect(all).not.toMatch(/change-me-now|teacher-pass-1/);
  });

  it('reset-password sets a student password (env or flag), revokes sessions, and never prints it', async () => {
    const seed = await seedTwoSchools();
    const [u] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, seed.a.studentId)));
    await createSession(seed.a.studentId);
    await cli('create-platform-admin', '--username', 'ops_pw', '--password', 'change-me-now', '--name', 'Ops');

    const r = await cli('reset-password', '--username', u.username!.toUpperCase(), '--password', 'fresh-secret-1', '--as', 'ops_pw');
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ userId: seed.a.studentId, username: u.username });
    expect([...r.out, ...r.err].join('\n')).not.toContain('fresh-secret-1');
    expect((await login(u.username!, 'fresh-secret-1')).actor.userId).toBe(seed.a.studentId);
    expect(await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, seed.a.studentId)))).toHaveLength(1); // only the login above

    process.env.ADMIN_PASSWORD = 'from-env-secret';
    try {
      expect((await cli('reset-password', '--username', u.username!, '--as', 'ops_pw')).code).toBe(0);
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
    expect((await login(u.username!, 'from-env-secret')).actor.userId).toBe(seed.a.studentId);

    expect((await cli('reset-password', '--username', u.username!, '--password', 'short', '--as', 'ops_pw')).err.join('\n')).toMatch(/WEAK_PASSWORD/);
    const missing = await cli('reset-password', '--username', 'no_such_student', '--password', 'valid-pass-1', '--as', 'ops_pw');
    expect(missing.code).toBe(1);
    expect(missing.err.join('\n')).toMatch(/NOT_FOUND/);
    const staff = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, seed.a.teacherId)));
    expect((await cli('reset-password', '--username', staff[0].username!, '--password', 'valid-pass-1', '--as', 'ops_pw')).code).toBe(1);
    expect((await cli('reset-password', '--password', 'valid-pass-1')).code).toBe(2); // --username required
  });

  it('school setup commands: create-section, create-subject, assign-teacher, list-school', async () => {
    await cli('create-platform-admin', '--username', 'ops_setup', '--password', 'change-me-now', '--name', 'Ops');
    const { schoolId } = (await cli('create-school', '--name', 'Setup School', '--board', 'CBSE', '--as', 'ops_setup')).json();
    const { branchId } = (await cli('create-branch', '--school', schoolId, '--name', 'Main', '--as', 'ops_setup')).json();
    await cli(
      'create-staff', '--school', schoolId, '--branch', branchId, '--role', 'teacher',
      '--username', 'Setup_Teacher', '--password', 'teacher-pass-1', '--name', 'Tess Teacher', '--as', 'ops_setup',
    );

    const sec = await cli('create-section', '--branch', branchId, '--grade', '8', '--name', '8-B', '--as', 'ops_setup');
    expect(sec.code).toBe(0);
    const { sectionId } = sec.json();
    const dupSec = await cli('create-section', '--branch', branchId, '--grade', '8', '--name', '8-B');
    expect(dupSec.code).toBe(1);
    expect(dupSec.err.join('\n')).toMatch(/VALIDATION/);
    expect((await cli('create-section', '--branch', branchId, '--grade', '4', '--name', 'x')).code).toBe(1);
    expect((await cli('create-section', '--branch', branchId, '--grade', 'abc', '--name', 'x')).code).toBe(1);
    expect((await cli('create-section', '--branch', 'not-a-uuid', '--grade', '8', '--name', 'x')).err.join('\n')).toMatch(/NOT_FOUND/);
    expect((await cli('create-section', '--grade', '8', '--name', 'x')).code).toBe(2);

    const sub = await cli('create-subject', '--school', schoolId, '--name', 'Science', '--as', 'ops_setup');
    expect(sub.code).toBe(0);
    const { subjectId } = sub.json();
    expect((await cli('create-subject', '--school', schoolId, '--name', 'Science')).err.join('\n')).toMatch(/VALIDATION/);

    const asg = await cli('assign-teacher', '--teacher', 'SETUP_TEACHER', '--section', sectionId, '--subject', subjectId, '--as', 'ops_setup');
    expect(asg.code).toBe(0);
    expect(asg.json()).toMatchObject({ teacher: 'setup_teacher', sectionId, subjectId });
    expect((await cli('assign-teacher', '--teacher', 'setup_teacher', '--section', sectionId, '--subject', subjectId)).code).toBe(0); // idempotent
    expect(await withPlatform((tx) => tx.select().from(teacherAssignments))).toHaveLength(1);
    const noTeacher = await cli('assign-teacher', '--teacher', 'nobody_here', '--section', sectionId, '--subject', subjectId);
    expect(noTeacher.code).toBe(1);
    expect(noTeacher.err.join('\n')).toMatch(/NOT_FOUND/);
    expect((await cli('assign-teacher', '--teacher', 'setup_teacher', '--section', sectionId)).code).toBe(2);

    const list = await cli('list-school', '--school', schoolId, '--as', 'ops_setup');
    expect(list.code).toBe(0);
    expect(list.json()).toMatchObject({
      school: { id: schoolId, name: 'Setup School' },
      branches: [{ id: branchId, name: 'Main', sections: [{ id: sectionId, grade: 8, name: '8-B' }] }],
      subjects: [{ id: subjectId, name: 'Science' }],
      teachers: [{ username: 'setup_teacher', name: 'Tess Teacher', branchId, branchName: 'Main' }],
    });
    expect((await cli('list-school', '--school', 'not-a-uuid')).err.join('\n')).toMatch(/NOT_FOUND/);
    expect((await cli('list-school')).code).toBe(2);
    expect(JSON.stringify(list.json())).not.toMatch(/passwordHash|teacher-pass-1/);
  });

  it('--as must name an existing platform admin', async () => {
    const r = await cli('create-school', '--name', 'S', '--board', 'CBSE', '--as', 'nobody_here');
    expect(r.code).not.toBe(0);
    expect(r.err.join('\n')).toMatch(/platform admin/i);
  });

  it('DomainErrors exit non-zero with code and message; usage errors too', async () => {
    const dup1 = await cli('create-platform-admin', '--username', 'dupe', '--password', 'long-enough-1', '--name', 'D');
    expect(dup1.code).toBe(0);
    const dup2 = await cli('create-platform-admin', '--username', 'DUPE', '--password', 'long-enough-1', '--name', 'D');
    expect(dup2.code).toBe(1);
    expect(dup2.err.join('\n')).toMatch(/USERNAME_TAKEN/);

    const weak = await cli('create-platform-admin', '--username', 'weakling', '--password', 'Zq9x', '--name', 'W');
    expect(weak.code).toBe(1);
    expect(weak.err.join('\n')).toMatch(/WEAK_PASSWORD/);
    expect(weak.err.join('\n')).not.toContain('Zq9x');

    const badNum = await cli('create-plan', '--name', 'P', '--interval', 'monthly', '--price-minor', '12abc');
    expect(badNum.code).toBe(1);
    expect(badNum.err.join('\n')).toMatch(/VALIDATION/);

    expect((await cli('frobnicate')).code).toBe(2);
    expect((await cli('create-school', '--name', 'S')).code).toBe(2); // missing --board
    expect((await cli('create-school', '--name', 'S', '--board', 'X', '--bogus', '1')).code).toBe(2);
  });

  it('reads the password from ADMIN_PASSWORD when --password is omitted', async () => {
    process.env.ADMIN_PASSWORD = 'from-env-pass';
    try {
      const r = await cli('create-platform-admin', '--username', 'env_admin', '--name', 'Env');
      expect(r.code).toBe(0);
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
    expect((await cli('create-platform-admin', '--username', 'env_admin2', '--name', 'Env')).code).toBe(2);
  });
});
