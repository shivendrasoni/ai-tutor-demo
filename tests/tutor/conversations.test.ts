import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withPlatform } from '@/db/client';
import { messages, skills, studentProfiles } from '@/db/schema';
import {
  createConversation,
  getMessages,
  listChatSubjects,
  listConversations,
  submitFeedback,
} from '@/modules/tutor';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activate, resetTutorFakes, seedTutorSkills, useTutorFakes } from '../helpers/tutor';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await seedTutorSkills();
  await activate(seed.a.student);
  await activate(seed.b.student);
});
beforeEach(() => {
  useTutorFakes({ subjects: [{ id: seed.a.subjectId, name: 'Mathematics' }] });
});
afterEach(async () => {
  resetTutorFakes();
  await withPlatform((tx) => tx.update(skills).set({ enabled: true }).where(eq(skills.key, 'explain')));
});

const assistantMsg = async (conversationId: string, role = 'assistant') => {
  const [m] = await withPlatform((tx) =>
    tx.insert(messages).values({ schoolId: seed.a.schoolId, conversationId, role, content: 'hello' }).returning(),
  );
  return m.id;
};

describe('conversations service', () => {
  it('creates, lists (own only), and gets messages; other student gets NOT_FOUND', async () => {
    const { id } = await createConversation(seed.a.student, { skillKey: 'socratic', subjectId: seed.a.subjectId });
    await createConversation(seed.b.student, { skillKey: 'explain' });
    const list = await listConversations(seed.a.student);
    expect(list.map((c) => c.id)).toContain(id);
    expect(list.find((c) => c.id === id)).toMatchObject({ skillKey: 'socratic', subjectId: seed.a.subjectId, title: null });
    expect(list.every((c) => c.skillKey)).toBe(true);
    expect(await getMessages(seed.a.student, id)).toEqual([]);
    await expect(getMessages(seed.b.student, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getMessages(seed.a.student, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listConversations(seed.b.student)).map((c) => c.id)).not.toContain(id);
  });

  it('pending student cannot create: FORBIDDEN', async () => {
    await withPlatform((tx) =>
      tx.update(studentProfiles).set({ status: 'pending_payment' }).where(eq(studentProfiles.userId, seed.b.student.userId)),
    );
    await expect(createConversation(seed.b.student, { skillKey: 'socratic' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await activate(seed.b.student);
  });

  it('rejects disabled/unknown/non-chat skill and invisible subject with VALIDATION', async () => {
    await expect(createConversation(seed.a.student, { skillKey: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await withPlatform((tx) => tx.update(skills).set({ enabled: false }).where(eq(skills.key, 'explain')));
    await expect(createConversation(seed.a.student, { skillKey: 'explain' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await withPlatform((tx) => tx.update(skills).set({ kind: 'generator' }).where(eq(skills.key, 'explain')));
    await expect(createConversation(seed.a.student, { skillKey: 'explain' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await withPlatform((tx) => tx.update(skills).set({ kind: 'chat' }).where(eq(skills.key, 'explain')));
    await expect(
      createConversation(seed.a.student, { skillKey: 'socratic', subjectId: seed.b.subjectId }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('submitFeedback flags the assistant message with reason student_feedback; user message or other student -> NOT_FOUND', async () => {
    const { id } = await createConversation(seed.a.student, { skillKey: 'socratic' });
    const a = await assistantMsg(id);
    const u = await assistantMsg(id, 'user');
    await submitFeedback(seed.a.student, a, { rating: 'down', comment: 'wrong' });
    const [row] = await getMessages(seed.a.student, id).then((r) => r.filter((m) => m.id === a));
    expect(row).toMatchObject({ flagged: true, flagReason: 'student_feedback', feedback: 'wrong' });
    await expect(submitFeedback(seed.a.student, u, { rating: 'down' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(submitFeedback(seed.b.student, a, { rating: 'down' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(submitFeedback(seed.a.student, 'bad', { rating: 'down' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('listChatSubjects returns the visible subjects for an active student and FORBIDDEN otherwise', async () => {
    expect(await listChatSubjects(seed.a.student)).toEqual([{ id: seed.a.subjectId, name: 'Mathematics' }]);
    await expect(listChatSubjects(seed.a.teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
