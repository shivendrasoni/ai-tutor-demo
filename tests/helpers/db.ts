import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appDb, withPlatform } from '@/db/client';
import {
  branches, memberships, plans, schools, sections, studentProfiles, subjects,
  subscriptions, teacherAssignments, users,
} from '@/db/schema';
import type { Actor, Role } from '@/modules/tenancy/actor';

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

const TABLES = [
  'invites', 'payments', 'subscriptions', 'student_profiles', 'teacher_assignments',
  'memberships', 'sessions', 'subjects', 'sections', 'branches', 'schools', 'plans', 'users',
];

/** Truncates all tables as the owner role. */
export async function resetDb(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  try {
    await drizzle(pool).execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`));
  } finally {
    await pool.end();
  }
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

export async function seedTwoSchools(): Promise<Seed> {
  return withPlatform(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({ name: 'Monthly', interval: 'monthly', priceMinor: 49900 })
      .returning();

    const seedSchool = async (label: string): Promise<SchoolSeed> => {
      const [school] = await tx.insert(schools).values({ name: `School ${label}`, board: 'CBSE' }).returning();
      const schoolId = school.id;
      const code = uniq();
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
          .values({ username: `${kind}-${label}-${uniq()}`, name: `${kind} ${label}` })
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
      .values({ username: `platform-${uniq()}`, name: 'Platform Admin', isPlatformAdmin: true })
      .returning();
    const platform: Actor = { userId: pu.id, isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };
    return { platform, planId: plan.id, a, b };
  });
}
