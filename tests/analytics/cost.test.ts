import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { costSummary } from '@/modules/analytics';
import { insertMessage, insertUsageDaily, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

let w: World;
const now = new Date('2027-03-10T12:00:00Z');
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const base = () => ({ schoolId: w.a.schoolId, studentId: w.a.student.userId, role: 'assistant' as const });
const at = new Date('2027-03-10T09:00:00Z');

describe('costSummary', () => {
  it('sums per school and per skill inside the window only', async () => {
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.a.student.userId, date: '2027-03-10', tokens: 1000, cost: 0.5 });
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.aActive1.userId, date: '2027-03-04', tokens: 500, cost: 0.25 });
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.a.student.userId, date: '2027-03-03', tokens: 9999, cost: 9 });
    await insertMessage({ ...base(), createdAt: at, skillKey: 'socratic', model: 'm', tokensIn: 100, tokensOut: 50, cost: 0.1 });
    await insertMessage({ ...base(), createdAt: at, skillKey: 'socratic', model: 'm', tokensIn: 100, tokensOut: 50, cost: 0.2 });
    await insertMessage({ ...base(), createdAt: at, skillKey: 'explain', model: 'm', tokensIn: 10, tokensOut: 5, cost: null });
    await insertMessage({ ...base(), createdAt: at, skillKey: 'explain', model: null }); // fixed reply: excluded
    await insertMessage({ ...base(), createdAt: new Date('2027-03-03T23:59:59.999Z'), skillKey: 'explain', model: 'm', tokensIn: 7, tokensOut: 7 });
    const r7 = await costSummary(w.platform, { days: 7, now });
    expect(r7.bySchool.find((s) => s.schoolId === w.a.schoolId)).toMatchObject({ cost: 0.75, tokens: 1500, students: 2 });
    const soc = r7.bySkill.find((s) => s.skillKey === 'socratic')!;
    expect(soc).toMatchObject({ turns: 2, tokens: 300 });
    expect(soc.cost).toBeCloseTo(0.3);
    expect(r7.bySkill.find((s) => s.skillKey === 'explain')).toMatchObject({ turns: 1, cost: 0, tokens: 15 });
    const r30 = await costSummary(w.platform, { days: 30, now });
    expect(r30.bySchool.find((s) => s.schoolId === w.a.schoolId)?.cost).toBeCloseTo(9.75);
  });

  it('school with no usage still listed with zeros; usage_daily boundary day is inclusive (Review Focus 1, 5)', async () => {
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.a.student.userId, date: '2027-03-04', tokens: 10, cost: 1 });
    await insertUsageDaily({ schoolId: w.a.schoolId, studentId: w.aActive1.userId, date: '2027-03-03', tokens: 99, cost: 99 });
    const r = await costSummary(w.platform, { days: 7, now });
    expect(r.bySchool.find((s) => s.schoolId === w.a.schoolId)).toMatchObject({ cost: 1, tokens: 10, students: 1 });
    expect(r.bySchool.find((s) => s.schoolId === w.b.schoolId)).toMatchObject({ cost: 0, tokens: 0, students: 0 });
    expect(r.bySchool[0]!.schoolId).toBe(w.a.schoolId); // cost desc
    expect(r.bySkill).toEqual([]);
  });

  it('non-platform actors FORBIDDEN; days 14 -> VALIDATION', async () => {
    await expect(costSummary(w.a.schoolAdmin, { days: 7, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(costSummary(w.a.student, { days: 7, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(costSummary(w.platform, { days: 14 as never, now })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
