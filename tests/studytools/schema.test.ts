import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { artifacts, attempts, examPatterns } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { statusFor } from '@/lib/http';
import { defaultPatternKey, getPattern, listExamPatterns, type ExamPatternRow } from '@/modules/studytools/patterns';
import { now, setNow } from '@/modules/studytools/clock';
import { appDbRaw, resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, insertArtifact } from '../helpers/study';

let seed: Seed;
beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  const art = await insertArtifact(seed.a.schoolId, seed.a.studentId, seed.a.subjectId);
  await withPlatform((tx) =>
    tx.insert(attempts).values({ schoolId: seed.a.schoolId, artifactId: art.id, studentId: seed.a.studentId, status: 'in_progress' }),
  );
});
afterAll(closeDb);

const total = (p: ExamPatternRow) => p.sections.reduce((n, s) => n + s.count * s.marksEach, 0);
const shape = (p: ExamPatternRow) => p.sections.map((s) => [s.key, s.questionType, s.count, s.marksEach]);

describe('exam patterns', () => {
  it('seeds the two exam patterns with exact sections and totals', async () => {
    const s80 = await getPattern('standard_80');
    const j50 = await getPattern('junior_50');
    expect([s80!.durationMinutes, total(s80!), s80!.gradeMin, s80!.gradeMax]).toEqual([180, 80, 9, 12]);
    expect(shape(s80!)).toEqual([['A', 'mcq', 20, 1], ['B', 'short', 5, 2], ['C', 'short', 6, 3], ['D', 'long', 4, 5], ['E', 'case', 3, 4]]);
    expect([j50!.durationMinutes, total(j50!), j50!.gradeMin, j50!.gradeMax]).toEqual([120, 50, 5, 8]);
    expect(shape(j50!)).toEqual([['A', 'mcq', 10, 1], ['B', 'short', 10, 2], ['C', 'long', 4, 5]]);
    expect(await getPattern('nope')).toBeNull();
  });
  it('listExamPatterns filters by grade', async () => {
    expect((await listExamPatterns(10)).map((p) => p.key)).toEqual(['standard_80']);
    expect((await listExamPatterns(6)).map((p) => p.key)).toEqual(['junior_50']);
    expect(defaultPatternKey(8)).toBe('junior_50');
    expect(defaultPatternKey(9)).toBe('standard_80');
  });
  it('exam_patterns is readable but not writable by app_user', async () => {
    expect(await withTenant(seed.a.schoolId, (tx) => tx.select().from(examPatterns))).toHaveLength(2);
    await expect(
      withTenant(seed.a.schoolId, (tx) => tx.delete(examPatterns).where(eq(examPatterns.key, 'junior_50'))),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } });
  });
});

describe('artifacts and attempts', () => {
  it('are tenant isolated and fail closed', async () => {
    expect(await withTenant(seed.b.schoolId, (tx) => tx.select().from(artifacts))).toHaveLength(0);
    expect(await withTenant(seed.b.schoolId, (tx) => tx.select().from(attempts))).toHaveLength(0);
    expect(await withTenant(seed.a.schoolId, (tx) => tx.select().from(artifacts))).toHaveLength(1);
    expect(await withTenant(seed.a.schoolId, (tx) => tx.select().from(attempts))).toHaveLength(1);
    for (const t of ['artifacts', 'attempts']) {
      expect((await appDbRaw(sql.raw(`select count(*)::int n from ${t}`))).rows[0].n).toBe(0);
    }
    const [skill] = await withPlatform((tx) => tx.execute(sql`select id from skills limit 1`)).then((r) => r.rows);
    await expect(
      withTenant(seed.a.schoolId, (tx) =>
        tx.insert(artifacts).values({
          schoolId: seed.b.schoolId, studentId: seed.a.studentId, skillId: String(skill.id), type: 'practice_test',
          subjectId: seed.a.subjectId, status: 'ready',
        }),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });
  it('defaults and cascade', async () => {
    const [a] = await withPlatform((tx) => tx.select().from(artifacts));
    expect(a.params).toEqual({ chapterTitles: {} });
    expect(a.sourceChunkIds).toEqual([]);
    const [at] = await withPlatform((tx) => tx.select().from(attempts));
    expect(at.answers).toEqual({});
    expect(at.startedAt).toBeInstanceOf(Date);
    await withPlatform((tx) => tx.delete(artifacts).where(eq(artifacts.id, a.id)));
    expect(await withPlatform((tx) => tx.select().from(attempts))).toHaveLength(0);
  });
  it('rejects an invalid artifact type or status', async () => {
    const [skill] = (await withPlatform((tx) => tx.execute(sql`select id from skills limit 1`))).rows;
    const base = { schoolId: seed.a.schoolId, studentId: seed.a.studentId, skillId: String(skill.id), subjectId: seed.a.subjectId };
    await expect(
      withPlatform((tx) => tx.insert(artifacts).values({ ...base, type: 'quiz', status: 'ready' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/artifacts_type_check/) } });
    await expect(
      withPlatform((tx) => tx.insert(artifacts).values({ ...base, type: 'mock_exam', status: 'done' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/artifacts_status_check/) } });
  });
});

describe('error codes and clock', () => {
  it('maps GENERATION_LIMIT to 429 and ATTEMPT_EXPIRED to 409', () => {
    expect(new DomainError('GENERATION_LIMIT').code).toBe('GENERATION_LIMIT');
    expect(statusFor('GENERATION_LIMIT')).toBe(429);
    expect(statusFor('ATTEMPT_EXPIRED')).toBe(409);
  });
  it('clock can be overridden and reset', () => {
    const fixed = new Date('2026-10-10T23:59:59Z');
    setNow(() => fixed);
    expect(now()).toBe(fixed);
    setNow(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
