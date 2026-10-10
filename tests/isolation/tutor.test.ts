/**
 * Cross-school (and cross-student) isolation for the tutor. Every case acts as School A's students
 * and targets School B ids; each must reject or return no B data, and B's rows must not change.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { conversations, memberships, messages, studentProfiles, usageDaily, users } from '@/db/schema';
import { createConversation, getMessages, listChatSubjects, listConversations, runTurn, submitFeedback, type TurnEvent } from '@/modules/tutor';
import type { Actor } from '@/modules/tenancy/actor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { seedChunks, seedItem } from '../helpers/content';
import { activate, resetTutorFakes, scriptedModel, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

let seed: Seed;
let a: Actor;
let a2: Actor; // a second active student in School A
let b: Actor;
let aConvId: string;
let bConvId: string;
let bMsgId: string;
let bSubjectId: string;

async function collect(it: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'RESOLVED',
    (e) => (e as { code?: string }).code ?? 'ERROR',
  );
const bMessageCount = () =>
  withPlatform(async (tx) => (await tx.select().from(messages).where(eq(messages.conversationId, bConvId))).length);

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  a = seed.a.student;
  b = seed.b.student;
  await seedTutorSkills();
  await Promise.all([activate(a), activate(b)]);
  a2 = await withPlatform(async (tx) => {
    const [u] = await tx.insert(users).values({ username: 'student_a2', name: 'Student A2', passwordHash: 'x' }).returning();
    await tx.insert(memberships).values({ userId: u.id, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'student' });
    await tx.insert(studentProfiles).values({
      userId: u.id, schoolId: seed.a.schoolId, branchId: seed.a.branchId, grade: 8, sectionId: seed.a.sectionId,
      parentName: 'P', parentPhone: '9999999999', status: 'active',
    });
    return { userId: u.id, isPlatformAdmin: false, schoolId: seed.a.schoolId, branchId: seed.a.branchId, roles: ['student'] } as Actor;
  });
  bSubjectId = seed.b.subjectId;
  // Real ready content for both schools (visible to each school's grade-8 student), so the real
  // content.subjects(scope) would surface B's subject on a leak.
  for (const s of [seed.a, seed.b]) {
    const item = await seedItem(s, { title: `Book ${s.schoolId}` });
    await seedChunks(item.id, [{ title: 'Chapter 1', texts: ['photosynthesis glucose'] }]);
  }

  // School B has a real conversation with messages and usage, so a leak would surface.
  useTutorFakes({ subjects: [{ id: seed.a.subjectId, name: 'Maths A' }, { id: bSubjectId, name: 'Maths B' }] });
  bConvId = (await createConversation(b, { skillKey: 'socratic' })).id;
  await collect(runTurn(b, bConvId, 'secret B question'));
  bMsgId = (await getMessages(b, bConvId)).find((m) => m.role === 'assistant')!.id;
  aConvId = (await createConversation(a, { skillKey: 'socratic' })).id;
  resetTutorFakes();
});
afterEach(() => resetTutorFakes());
afterAll(async () => {
  await closeDb();
});

describe('tutor isolation: School A students vs School B ids', () => {
  it('A cannot read B conversations or messages', async () => {
    expect(await codeOf(getMessages(a, bConvId))).toBe('NOT_FOUND');
    const own = await listConversations(a);
    expect(own.map((c) => c.id)).toEqual([aConvId]);
    expect(own.some((c) => c.id === bConvId)).toBe(false);
    // Non-vacuous: B really has data.
    expect((await getMessages(b, bConvId)).length).toBe(2);
  });

  it('A cannot chat in a B conversation (no model call, no rows written)', async () => {
    const { model } = useTutorFakes({ model: scriptedModel([{ text: 'x' }]) });
    const before = await bMessageCount();
    const usageBefore = await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.schoolId, seed.b.schoolId)));
    expect(await codeOf(collect(runTurn(a, bConvId, 'hi')))).toBe('NOT_FOUND');
    expect(model.calls).toBe(0);
    expect(await bMessageCount()).toBe(before);
    expect(await withPlatform((tx) => tx.select().from(usageDaily).where(eq(usageDaily.schoolId, seed.b.schoolId)))).toEqual(usageBefore);
  });

  it('A cannot give feedback on a B message; the B message stays unflagged', async () => {
    expect(await codeOf(submitFeedback(a, bMsgId, { rating: 'down', comment: 'bad' }))).toBe('NOT_FOUND');
    const [m] = await withPlatform((tx) => tx.select().from(messages).where(eq(messages.id, bMsgId)));
    expect(m.flagged).toBe(false);
    expect(m.feedback).toBeNull();
  });

  it('A cannot create a conversation with a B subject (real content layer)', async () => {
    // Non-vacuous: B's own student can use B's subject, and A can use A's.
    expect(await listChatSubjects(b)).toEqual([expect.objectContaining({ id: bSubjectId })]);
    expect(await codeOf(createConversation(a, { skillKey: 'socratic', subjectId: bSubjectId }))).toBe('VALIDATION');
    const ok = await createConversation(a, { skillKey: 'socratic', subjectId: seed.a.subjectId });
    expect(ok.id).toBeTruthy();
    await withPlatform((tx) => tx.delete(conversations).where(eq(conversations.id, ok.id)));
  });

  it('listChatSubjects returns only the A student visible subjects; a teacher is FORBIDDEN', async () => {
    const subs = await listChatSubjects(a);
    expect(subs.map((x) => x.id)).toEqual([seed.a.subjectId]);
    expect(subs.some((x) => x.id === bSubjectId)).toBe(false);
    expect(await codeOf(listChatSubjects(seed.a.teacher))).toBe('FORBIDDEN');
    expect(await codeOf(listChatSubjects(seed.a.schoolAdmin))).toBe('FORBIDDEN');
  });

  it('usage_daily rows are only A when A chats', async () => {
    useTutorFakes();
    const bUsageBefore = await withTenant(seed.b.schoolId, (tx) => tx.select().from(usageDaily));
    expect(bUsageBefore.length).toBe(1); // B's own turn
    await collect(runTurn(a, aConvId, 'A question'));
    const bUsage = await withTenant(seed.b.schoolId, (tx) => tx.select().from(usageDaily));
    expect(bUsage).toEqual(bUsageBefore);
    const aUsage = await withTenant(seed.a.schoolId, (tx) => tx.select().from(usageDaily));
    expect(aUsage.length).toBeGreaterThan(0);
    expect(aUsage.every((r) => r.schoolId === seed.a.schoolId && r.studentId === a.userId)).toBe(true);
  });

  it("a student cannot read, chat in, or flag a classmate's conversation in the same school", async () => {
    const { model } = useTutorFakes({ model: scriptedModel([{ text: 'x' }]) });
    expect(await codeOf(getMessages(a2, aConvId))).toBe('NOT_FOUND');
    expect(await listConversations(a2)).toEqual([]);
    expect(await codeOf(collect(runTurn(a2, aConvId, 'hi')))).toBe('NOT_FOUND');
    expect(model.calls).toBe(0);
    const aAssistant = (await getMessages(a, aConvId)).find((m) => m.role === 'assistant')!;
    expect(await codeOf(submitFeedback(a2, aAssistant.id, { rating: 'down' }))).toBe('NOT_FOUND');
    const [m] = await withPlatform((tx) => tx.select().from(messages).where(eq(messages.id, aAssistant.id)));
    expect(m.flagged).toBe(false);
  });

  it('raw: withTenant(A) on conversations/messages/usage_daily returns only A rows', async () => {
    const convs = await withTenant(seed.a.schoolId, (tx) => tx.select().from(conversations));
    const msgs = await withTenant(seed.a.schoolId, (tx) => tx.select().from(messages));
    const usage = await withTenant(seed.a.schoolId, (tx) => tx.select().from(usageDaily));
    expect(convs.length).toBeGreaterThan(0);
    expect(msgs.length).toBeGreaterThan(0);
    for (const rows of [convs, msgs, usage]) expect(rows.every((r) => r.schoolId === seed.a.schoolId)).toBe(true);
    expect(convs.some((c) => c.id === bConvId)).toBe(false);
    expect(msgs.some((m) => m.conversationId === bConvId)).toBe(false);
    // A tenant-scoped write cannot target B's rows.
    const upd = await withTenant(seed.a.schoolId, (tx) =>
      tx.update(messages).set({ flagged: true }).where(eq(messages.id, bMsgId)).returning({ id: messages.id }),
    );
    expect(upd).toEqual([]);
  });
});
