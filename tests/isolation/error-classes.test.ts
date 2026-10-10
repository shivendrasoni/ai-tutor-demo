/** Pins the "final #4" error-code rule (AS-BUILT-1, "Errors and HTTP") with one example of each class. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { listStudents, manualAddStudent, recordPayment, removeStudent } from '@/modules/enrollment';
import { assignTeacher, createSection, listTeachers } from '@/modules/tenancy';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
const BAD = 'not-a-uuid';

describe('malformed id error classes', () => {
  it('ids that select the TARGET resource are NOT_FOUND', async () => {
    expect(await codeOf(removeStudent(seed.a.schoolAdmin, BAD))).toBe('NOT_FOUND');
    expect(await codeOf(createSection(seed.a.schoolAdmin, { branchId: BAD, grade: 8, name: 'X' }))).toBe('NOT_FOUND');
    expect(await codeOf(assignTeacher(seed.a.schoolAdmin, { teacherId: BAD, sectionId: seed.a.sectionId, subjectId: seed.a.subjectId }))).toBe('NOT_FOUND');
    expect(await codeOf(recordPayment(seed.platform, { subscriptionId: BAD, amountMinor: 1, currency: 'INR', paidAt: new Date() }))).toBe('NOT_FOUND');
    expect(await codeOf(listTeachers(seed.platform, BAD))).toBe('NOT_FOUND');
  });

  it('ids that are form CHOICES and list FILTER params are VALIDATION', async () => {
    const input = { branchId: seed.a.branchId, grade: 8, sectionId: BAD, studentName: 'S', parentName: 'P', parentPhone: '1' };
    expect(await codeOf(manualAddStudent(seed.a.schoolAdmin, input))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.platform, { schoolId: BAD }))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { branchId: BAD }))).toBe('VALIDATION');
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { grade: 99 }))).toBe('VALIDATION');
  });

  it("a non-platform caller's foreign schoolId filter is FORBIDDEN", async () => {
    expect(await codeOf(listStudents(seed.a.schoolAdmin, { schoolId: seed.b.schoolId }))).toBe('FORBIDDEN');
  });
});
