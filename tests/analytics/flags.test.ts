import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { messages } from '@/db/schema';
import { getFlaggedConversation, listFlagged, markReviewed } from '@/modules/analytics';
import { insertMessage, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const a = () => ({ schoolId: w.a.schoolId, studentId: w.a.student.userId, createdAt: new Date('2027-03-10T09:00:00Z') });
const row = async (id: string) =>
  (await withPlatform((tx) => tx.select().from(messages).where(eq(messages.id, id))))[0];

describe('flagged queue', () => {
  it('open vs reviewed lists and markReviewed moves a row between them', async () => {
    const id = await insertMessage({ ...a(), role: 'user', content: 'x'.repeat(300), flagged: true, flagReason: 'decider_review' });
    await insertMessage({ ...a(), role: 'user', content: 'not flagged' });
    const open = await listFlagged(w.platform, { status: 'open' });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ messageId: id, reason: 'decider_review', schoolName: expect.any(String), studentName: expect.any(String) });
    expect(open[0].excerpt).toHaveLength(161);
    expect(open[0].excerpt.endsWith('…')).toBe(true);
    await markReviewed(w.platform, id);
    expect(await listFlagged(w.platform, { status: 'open' })).toHaveLength(0);
    expect(await listFlagged(w.platform, { status: 'reviewed' })).toHaveLength(1);
  });

  it('short content has no ellipsis; ordered newest first; invalid status is VALIDATION', async () => {
    const old = await insertMessage({ ...a(), role: 'user', content: 'short', flagged: true, createdAt: new Date('2027-03-01T00:00:00Z') });
    const recent = await insertMessage({ ...a(), role: 'user', content: 'y', flagged: true });
    const open = await listFlagged(w.platform, { status: 'open' });
    expect(open.map((r) => r.messageId)).toEqual([recent, old]);
    expect(open[1].excerpt).toBe('short');
    await expect(listFlagged(w.platform, { status: 'bogus' as never })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('markReviewed is idempotent and records reviewer', async () => {
    const id = await insertMessage({ ...a(), role: 'user', flagged: true });
    await markReviewed(w.platform, id);
    const first = (await row(id)).reviewedAt;
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await markReviewed(w.platform, id);
    expect((await row(id)).reviewedAt).toEqual(first);
    expect((await row(id)).reviewedBy).toBe(w.platform.userId);
  });

  it('getFlaggedConversation reports reviewedAt/reviewedBy (null until reviewed)', async () => {
    const id = await insertMessage({ ...a(), role: 'user', flagged: true });
    const before = await getFlaggedConversation(w.platform, id);
    expect(before.reviewedAt).toBeNull();
    expect(before.reviewedBy).toBeNull();
    await markReviewed(w.platform, id);
    const after = await getFlaggedConversation(w.platform, id);
    expect(after.reviewedAt).toBeInstanceOf(Date);
    expect(after.reviewedBy).toBe(w.platform.userId);
  });

  it('unflagged, unknown or malformed id -> NOT_FOUND for getFlaggedConversation and markReviewed', async () => {
    const id = await insertMessage({ ...a(), role: 'user' });
    for (const bad of [id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      await expect(getFlaggedConversation(w.platform, bad)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(markReviewed(w.platform, bad)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('getFlaggedConversation returns only that conversation in order with flaggedMessageId', async () => {
    const t = (s: number) => new Date(Date.UTC(2027, 2, 10, 9, 0, s));
    const m1 = await insertMessage({ ...a(), role: 'user', content: 'first', createdAt: t(1) });
    const conv = (await row(m1)).conversationId;
    const m3 = await insertMessage({ ...a(), role: 'assistant', content: 'third', createdAt: t(3), conversationId: conv });
    const m2 = await insertMessage({ ...a(), role: 'user', content: 'second', createdAt: t(2), conversationId: conv, flagged: true });
    await insertMessage({ schoolId: w.a.schoolId, studentId: w.aActive1.userId, role: 'user', content: 'other student', createdAt: t(2) });
    const r = await getFlaggedConversation(w.platform, m2);
    expect(r.flaggedMessageId).toBe(m2);
    expect(r.messages.map((m) => m.id)).toEqual([m1, m2, m3]);
    expect(r.messages.every((m) => m.conversationId === conv)).toBe(true);
  });

  it.each(['school_admin', 'branch_admin', 'teacher', 'student'] as const)('%s is FORBIDDEN on every platform function', async (role) => {
    const actor = { schoolAdmin: w.a.schoolAdmin, branchAdmin: w.a.branchAdmin, teacher: w.a.teacher, student: w.a.student }[
      role === 'school_admin' ? 'schoolAdmin' : role === 'branch_admin' ? 'branchAdmin' : role
    ];
    const id = await insertMessage({ ...a(), role: 'user', flagged: true });
    const { listSchools, platformOverview } = await import('@/modules/analytics');
    for (const fn of [
      () => listFlagged(actor, { status: 'open' }), () => getFlaggedConversation(actor, id),
      () => markReviewed(actor, id), () => listSchools(actor), () => platformOverview(actor),
    ])
      await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
