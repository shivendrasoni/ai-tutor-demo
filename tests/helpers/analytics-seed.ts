import { eq } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import {
  artifacts, attempts, branches, chunks, contentChapters, contentItems, conversations, memberships, messages, sections, skills, studentProfiles, subjects,
  usageDaily, users,
} from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import type { Actor } from '@/modules/tenancy/actor';
import { generateBranchCode } from '@/modules/tenancy/codes';
import { seedTwoSchools, type Seed } from './db';

export type World = Seed & {
  aBranch2Id: string;
  aSection9Id: string; // branch A1, grade 9, teacher NOT assigned
  aSection2Id: string; // branch A2, grade 8
  aSubject2Id: string; // second subject in school A
  aActive1: Actor; // s_active1 (A1, 8-A)
  aActive2: Actor; // s_active2 (A1, 8-A)
  aLapsedId: string;
  aRemovedId: string;
};

type Status = 'pending_payment' | 'active' | 'lapsed' | 'removed';

/** School A: A1 g8 (seed pending + 2 active + 1 lapsed + 1 removed), A1 g9 (1 active, no section),
 *  A2 g8 (1 pending), A2 g9 (2 active). School B: seed pending + 3 active g8. */
export async function seedAnalyticsWorld(): Promise<World> {
  const seed = await seedTwoSchools();
  return withPlatform(async (tx) => {
    const mk = async (
      schoolId: string, branchId: string, grade: number, sectionId: string | null,
      status: Status, username: string,
    ): Promise<Actor> => {
      const [u] = await tx
        .insert(users)
        .values({ username, name: `Student ${username}`, passwordHash: 'x' })
        .returning();
      await tx.insert(memberships).values({ userId: u.id, schoolId, branchId, role: 'student' });
      await tx.insert(studentProfiles).values({
        userId: u.id, schoolId, branchId, grade, sectionId, status, parentName: 'P', parentPhone: '9999999999',
      });
      return { userId: u.id, isPlatformAdmin: false, schoolId, branchId, roles: ['student'] };
    };
    const A = seed.a;
    const [branch2] = await tx
      .insert(branches)
      .values({ schoolId: A.schoolId, name: 'Branch A2', signupCode: generateBranchCode() })
      .returning();
    const [s9] = await tx
      .insert(sections).values({ schoolId: A.schoolId, branchId: A.branchId, grade: 9, name: '9-A' }).returning();
    const [s2] = await tx
      .insert(sections).values({ schoolId: A.schoolId, branchId: branch2.id, grade: 8, name: '8-A' }).returning();
    const [s2g9] = await tx
      .insert(sections).values({ schoolId: A.schoolId, branchId: branch2.id, grade: 9, name: '9-A' }).returning();
    const [subj2] = await tx.insert(subjects).values({ schoolId: A.schoolId, name: 'Science' }).returning();

    const aActive1 = await mk(A.schoolId, A.branchId, 8, A.sectionId, 'active', 's_active1');
    const aActive2 = await mk(A.schoolId, A.branchId, 8, A.sectionId, 'active', 's_active2');
    const lapsed = await mk(A.schoolId, A.branchId, 8, A.sectionId, 'lapsed', 's_lapsed');
    const removed = await mk(A.schoolId, A.branchId, 8, A.sectionId, 'removed', 's_removed');
    await mk(A.schoolId, A.branchId, 9, null, 'active', 'a1_g9_active');
    await mk(A.schoolId, branch2.id, 8, s2.id, 'pending_payment', 'a2_g8_pending');
    await mk(A.schoolId, branch2.id, 9, s2g9.id, 'active', 'a2_g9_active1');
    await mk(A.schoolId, branch2.id, 9, s2g9.id, 'active', 'a2_g9_active2');
    for (let i = 1; i <= 3; i++) await mk(seed.b.schoolId, seed.b.branchId, 8, seed.b.sectionId, 'active', `b_active${i}`);
    // The seed teacher is already assigned to 8-A + Mathematics only.
    return {
      ...seed,
      aBranch2Id: branch2.id,
      aSection9Id: s9.id,
      aSection2Id: s2.id,
      aSubject2Id: subj2.id,
      aActive1,
      aActive2,
      aLapsedId: lapsed.userId,
      aRemovedId: removed.userId,
    };
  });
}

async function skillId(key: string): Promise<string> {
  await seedSkills(); // idempotent upsert; skills are global and wiped by resetDb
  const [row] = await withPlatform((tx) => tx.select({ id: skills.id }).from(skills).where(eq(skills.key, key)));
  if (!row) throw new Error(`unknown skill ${key}`);
  return row.id;
}

export async function insertMessage(o: {
  schoolId: string; studentId: string; role: 'user' | 'assistant'; createdAt: Date;
  subjectId?: string; skillKey?: string; content?: string; decisions?: object | null;
  model?: string | null; tokensIn?: number; tokensOut?: number; cost?: number | null;
  flagged?: boolean; flagReason?: string | null; conversationId?: string;
}): Promise<string> {
  const sid = await skillId(o.skillKey ?? 'socratic');
  return withPlatform(async (tx) => {
    let conversationId = o.conversationId;
    if (!conversationId) {
      const [c] = await tx
        .insert(conversations)
        .values({
          schoolId: o.schoolId, studentId: o.studentId, skillId: sid, subjectId: o.subjectId ?? null,
          createdAt: o.createdAt, updatedAt: o.createdAt,
        })
        .returning({ id: conversations.id });
      conversationId = c.id;
    }
    const [m] = await tx
      .insert(messages)
      .values({
        schoolId: o.schoolId, conversationId, role: o.role, content: o.content ?? 'hello',
        decisions: o.decisions ?? null, model: o.model ?? null,
        tokensIn: o.tokensIn ?? 0, tokensOut: o.tokensOut ?? 0,
        cost: o.cost == null ? null : String(o.cost),
        flagged: o.flagged ?? false, flagReason: o.flagReason ?? null, createdAt: o.createdAt,
      })
      .returning({ id: messages.id });
    return m.id;
  });
}

export async function insertUsageDaily(o: {
  schoolId: string; studentId: string; date: string; tokens: number; cost: number;
}): Promise<void> {
  await withPlatform((tx) =>
    tx.insert(usageDaily).values({
      schoolId: o.schoolId, studentId: o.studentId, date: o.date, tokens: o.tokens, cost: String(o.cost),
    }),
  );
}

/** A school with a school_admin only: zero branches, zero students. */
export async function createEmptySchool(platform: Actor): Promise<{ schoolId: string; admin: Actor }> {
  const { createSchool, createStaffUser } = await import('@/modules/tenancy');
  const { id: schoolId } = await createSchool(platform, { name: 'Empty School', board: 'CBSE' });
  const { userId } = await createStaffUser(platform, {
    schoolId, branchId: null, role: 'school_admin', username: 'empty_admin', password: 'correct-horse', name: 'Empty Admin',
  });
  return { schoolId, admin: { userId, isPlatformAdmin: false, schoolId, branchId: null, roles: ['school_admin'] } };
}

/** A `ready` content item (school scope, or section scope when `sectionId` is given) with one chapter and one chunk
 *  (chapters without chunks are invisible to students). */
export async function insertChapter(o: {
  schoolId: string; branchId: string; sectionId?: string; subjectId: string; grade: number; title: string;
}): Promise<{ chapterId: string; contentItemId: string }> {
  return withPlatform(async (tx) => {
    const [mem] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.schoolId, o.schoolId)).limit(1);
    const [item] = await tx
      .insert(contentItems)
      .values({
        schoolId: o.schoolId, grade: o.grade, subjectId: o.subjectId, kind: 'book',
        scope: o.sectionId ? 'section' : 'school', branchId: o.sectionId ? o.branchId : null,
        sectionId: o.sectionId ?? null, title: `Book ${o.title}`, fileKey: `k/${o.title}`,
        uploadedBy: mem.userId, ingestStatus: 'ready', sizeBytes: 1,
      })
      .returning({ id: contentItems.id });
    const [ch] = await tx
      .insert(contentChapters)
      .values({ schoolId: o.schoolId, contentItemId: item.id, ordinal: 1, title: o.title, pageStart: 1, pageEnd: 2 })
      .returning({ id: contentChapters.id });
    await tx.insert(chunks).values({
      schoolId: o.schoolId, contentItemId: item.id, chapterId: ch.id, ordinal: 1, pageStart: 1, pageEnd: 2,
      text: 'text', tokenEstimate: 1,
    });
    return { chapterId: ch.id, contentItemId: item.id };
  });
}

/** One graded attempt (with its artifact) whose `by_chapter` is `byChapter`. */
export async function insertGradedAttempt(o: {
  schoolId: string; studentId: string; subjectId: string; byChapter: Record<string, { scored: number; max: number }>;
}): Promise<void> {
  const sid = await skillId('socratic');
  await withPlatform(async (tx) => {
    const [a] = await tx
      .insert(artifacts)
      .values({
        schoolId: o.schoolId, studentId: o.studentId, skillId: sid, type: 'practice_test', subjectId: o.subjectId,
        chapterIds: Object.keys(o.byChapter), status: 'ready', content: { questions: [] },
        params: { chapterTitles: {} },
      })
      .returning({ id: artifacts.id });
    const vals = Object.values(o.byChapter);
    await tx.insert(attempts).values({
      schoolId: o.schoolId, artifactId: a.id, studentId: o.studentId, status: 'graded',
      byChapter: o.byChapter, score: String(vals.reduce((n, v) => n + v.scored, 0)),
      maxScore: String(vals.reduce((n, v) => n + v.max, 0)), submittedAt: new Date(), gradedAt: new Date(),
    });
  });
}
