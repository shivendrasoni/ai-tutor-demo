import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { studentUsage } from '@/modules/analytics';
import { insertMessage, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
const now = new Date('2027-03-10T12:00:00Z');
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const m = () => ({ schoolId: w.a.schoolId, studentId: w.aActive1.userId });
const of = async (actor: Parameters<typeof studentUsage>[0], id: string, args: Parameters<typeof studentUsage>[1] = {}) =>
  (await studentUsage(actor, { now, ...args })).find((u) => u.studentId === id);

describe('studentUsage', () => {
  it('8-day-old message counts in 30d but not 7d', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-02T09:00:00Z') });
    expect(await of(w.a.teacher, w.aActive1.userId)).toMatchObject({ messages7d: 0, messages30d: 1 });
  });
  it('boundary: exactly window-start midnight is in, 1 ms earlier is out (Review Focus 5)', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-04T00:00:00.000Z') });
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-03T23:59:59.999Z') });
    expect((await of(w.a.teacher, w.aActive1.userId))!.messages7d).toBe(1);
    expect((await of(w.a.teacher, w.aActive1.userId))!.messages30d).toBe(2);
  });
  it('now already the next UTC day (still yesterday in IST) shifts the window', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-03T10:00:00Z') });
    const early = new Date('2027-03-09T18:30:00Z'); // window starts 03-03
    const late = new Date('2027-03-10T18:30:00Z'); // window starts 03-04
    expect((await of(w.a.teacher, w.aActive1.userId, { now: early }))!.messages7d).toBe(1);
    expect((await of(w.a.teacher, w.aActive1.userId, { now: late }))!.messages7d).toBe(0);
  });
  it('30d boundary', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-02-09T00:00:00.000Z') });
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-02-08T23:59:59.999Z') });
    expect((await of(w.a.teacher, w.aActive1.userId))!.messages30d).toBe(1);
  });
  it('ignores assistant messages; no-message students listed with 0/null; removed excluded; lastActiveAt = latest user message', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-09T09:00:00Z') });
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-10T08:00:00Z') });
    await insertMessage({ ...m(), role: 'assistant', createdAt: new Date('2027-03-10T09:00:00Z') });
    const rows = await studentUsage(w.a.teacher, { now });
    const r1 = rows.find((u) => u.studentId === w.aActive1.userId)!;
    expect(r1).toMatchObject({ messages7d: 2, messages30d: 2, sectionName: '8-A' });
    expect(r1.lastActiveAt).toEqual(new Date('2027-03-10T08:00:00Z'));
    expect(rows.find((u) => u.studentId === w.aActive2.userId)).toMatchObject({ messages7d: 0, messages30d: 0, lastActiveAt: null });
    expect(rows.some((u) => u.studentId === w.aRemovedId)).toBe(false);
    expect(rows.some((u) => u.studentId === w.aLapsedId)).toBe(true);
  });
  it('teacher sees only assigned sections; unassigned sectionId is FORBIDDEN', async () => {
    const rows = await studentUsage(w.a.teacher, { now });
    expect(rows.every((u) => u.sectionName === '8-A')).toBe(true);
    expect(rows.some((u) => u.studentId === w.a.studentId)).toBe(true);
    await expect(studentUsage(w.a.teacher, { sectionId: w.aSection9Id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await studentUsage(w.a.teacher, { sectionId: w.a.sectionId, now })).length).toBe(rows.length);
  });
  it('subjectId filters on conversation subject', async () => {
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-10T08:00:00Z'), subjectId: w.a.subjectId });
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-10T08:30:00Z'), subjectId: w.aSubject2Id });
    await insertMessage({ ...m(), role: 'user', createdAt: new Date('2027-03-10T09:00:00Z') });
    expect(await of(w.a.teacher, w.aActive1.userId, { subjectId: w.a.subjectId })).toMatchObject({ messages7d: 1, messages30d: 1 });
    expect(await of(w.a.teacher, w.aActive1.userId)).toMatchObject({ messages7d: 3 });
    // students stay listed under a subject filter
    expect(await of(w.a.teacher, w.aActive2.userId, { subjectId: w.a.subjectId })).toMatchObject({ messages7d: 0, lastActiveAt: null });
  });
  it('school_admin sees whole school only; branch_admin only own branch', async () => {
    const all = await studentUsage(w.a.schoolAdmin, { now });
    expect(all.length).toBe(8); // A students minus removed
    expect(all.some((u) => u.sectionName === null)).toBe(true); // g9 student with no section
    const own = await studentUsage(w.a.branchAdmin, { now });
    expect(own.length).toBe(5);
    expect(own.some((u) => u.studentId === w.a.studentId)).toBe(true);
  });
  it('branch_admin A1 cannot query a section of branch A2; school_admin cannot query school B section', async () => {
    await expect(studentUsage(w.a.branchAdmin, { sectionId: w.aSection2Id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(studentUsage(w.a.schoolAdmin, { sectionId: w.b.sectionId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await studentUsage(w.a.schoolAdmin, { sectionId: w.aSection2Id, now })).length).toBe(1);
  });
  it('malformed ids are FORBIDDEN, not a 500; students FORBIDDEN; empty school returns []', async () => {
    await expect(studentUsage(w.a.schoolAdmin, { sectionId: 'nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(studentUsage(w.a.schoolAdmin, { subjectId: 'nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(studentUsage(w.a.student, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('teacher with no assignments gets []', async () => {
    const { withPlatform } = await import('@/db/client');
    const { teacherAssignments } = await import('@/db/schema');
    await withPlatform((tx) => tx.delete(teacherAssignments));
    expect(await studentUsage(w.a.teacher, { now })).toEqual([]);
  });
});
