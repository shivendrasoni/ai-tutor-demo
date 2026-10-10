import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appDb, withPlatform } from '@/db/client';
import {
  branches, memberships, plans, schools, sections, studentProfiles, subjects,
  subscriptions, teacherAssignments, users,
} from '@/db/schema';
import { hashPassword } from '@/modules/tenancy/auth/passwords';
import type { Actor, Role } from '@/modules/tenancy/actor';
import { generateBranchCode } from '@/modules/tenancy/codes';
import { withDeadlockRetry } from './retry';

export type SchoolSeed = {
  schoolId: string;
  branchId: string;
  code: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  studentId: string;
  subscriptionId: string;
  schoolAdmin: Actor;
  branchAdmin: Actor;
  teacher: Actor;
  student: Actor;
};
export type Seed = { platform: Actor; planId: string; a: SchoolSeed; b: SchoolSeed };

/** Truncates every table in schema public (as owner), so future tables can't survive a reset. */
export async function resetDb(): Promise<void> {
  // A request still in flight from a previous spec can deadlock with the truncate, so retry.
  await withDeadlockRetry(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER, options: '-c lock_timeout=5000' });
    try {
      const db = drizzle(pool);
      const res = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
      // exam_patterns is seeded by a migration (global reference data), so a reset keeps it.
      const names = res.rows.filter((r) => r.tablename !== 'exam_patterns').map((r) => `"${r.tablename}"`);
      if (names.length) await db.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`));
    } finally {
      await pool.end();
    }
  });
}

/** Runs one statement on the app pool (app_user) with no tenant setup. */
export function appDbRaw(q: SQL) {
  return appDb.execute(q);
}

export async function currentCode(branchId: string): Promise<string> {
  const rows = await withPlatform((tx) =>
    tx.select({ code: branches.signupCode }).from(branches).where(sql`${branches.id} = ${branchId}`),
  );
  return rows[0].code;
}

const uniq = () => randomBytes(4).toString('hex'); // 8 chars

/** Password for every seeded user (argon2-hashed once, lazily, and reused). */
export const SEED_PASSWORD = 'correct-horse';
let seedHash: Promise<string> | undefined;
const getSeedHash = () => (seedHash ??= hashPassword(SEED_PASSWORD));

export async function seedTwoSchools(): Promise<Seed> {
  const passwordHash = await getSeedHash();
  return withPlatform(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({ name: 'Monthly', interval: 'monthly', priceMinor: 49900 })
      .returning();

    const seedSchool = async (label: string): Promise<SchoolSeed> => {
      const [school] = await tx.insert(schools).values({ name: `School ${label}`, board: 'CBSE' }).returning();
      const schoolId = school.id;
      const code = generateBranchCode();
      const [branch] = await tx
        .insert(branches)
        .values({ schoolId, name: `Branch ${label}`, signupCode: code })
        .returning();
      const branchId = branch.id;
      const [section] = await tx.insert(sections).values({ schoolId, branchId, grade: 8, name: '8-A' }).returning();
      const [subject] = await tx.insert(subjects).values({ schoolId, name: 'Mathematics' }).returning();

      const mkUser = async (kind: string, role: Role, bId: string | null): Promise<Actor & { userId: string }> => {
        const [u] = await tx
          .insert(users)
          .values({ username: `${kind.replace('-', '_')}_${label.toLowerCase()}_${uniq()}`, name: `${kind} ${label}`, passwordHash })
          .returning();
        await tx.insert(memberships).values({ userId: u.id, schoolId, branchId: bId, role });
        return { userId: u.id, isPlatformAdmin: false, schoolId, branchId: bId, roles: [role] };
      };
      const schoolAdmin = await mkUser('school-admin', 'school_admin', null);
      const branchAdmin = await mkUser('branch-admin', 'branch_admin', branchId);
      const teacher = await mkUser('teacher', 'teacher', branchId);
      const student = await mkUser('student', 'student', branchId);

      await tx.insert(teacherAssignments).values({
        schoolId, teacherId: teacher.userId, sectionId: section.id, subjectId: subject.id,
      });
      await tx.insert(studentProfiles).values({
        userId: student.userId, schoolId, branchId, grade: 8, sectionId: section.id,
        parentName: `Parent ${label}`, parentPhone: '9999999999',
      });
      const [sub] = await tx
        .insert(subscriptions)
        .values({ schoolId, studentId: student.userId, planId: plan.id })
        .returning();

      return {
        schoolId, branchId, code, sectionId: section.id, subjectId: subject.id,
        teacherId: teacher.userId, studentId: student.userId, subscriptionId: sub.id,
        schoolAdmin, branchAdmin, teacher, student,
      };
    };

    const a = await seedSchool('A');
    const b = await seedSchool('B');
    const [pu] = await tx
      .insert(users)
      .values({ username: `platform_${uniq()}`, name: 'Platform Admin', isPlatformAdmin: true, passwordHash })
      .returning();
    const platform: Actor = { userId: pu.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };
    return { platform, planId: plan.id, a, b };
  });
}
