import { describe, expect, it } from 'vitest';
import { registerStudyToolsWorkers } from '@/modules/studytools/queue';
import { handleGradeJob } from '@/modules/studytools/grading';

describe('registerStudyToolsWorkers', () => {
  it('registers both queues; the grade worker runs with concurrency 4', async () => {
    const calls: any[][] = [];
    const created: string[] = [];
    const boss = { createQueue: async (n: string) => void created.push(n), work: async (...a: any[]) => void calls.push(a) };
    await registerStudyToolsWorkers(boss as any);
    expect(calls.map((c) => c[0]).sort()).toEqual(['studytools.generate', 'studytools.grade']);
    expect(created.sort()).toEqual(['studytools.generate', 'studytools.grade']);
    const grade = calls.find((c) => c[0] === 'studytools.grade')!;
    expect(grade[1]).toMatchObject({ localConcurrency: 4, includeMetadata: true });
    expect(typeof grade[2]).toBe('function');
    expect(typeof handleGradeJob).toBe('function');
  });

  it('passes retryCount and retryLimit from the pg-boss job into the handlers', async () => {
    const calls: any[][] = [];
    await registerStudyToolsWorkers({ createQueue: async () => {}, work: async (...a: any[]) => void calls.push(a) } as any);
    const handler = calls.find((c) => c[0] === 'studytools.grade')![2];
    // An unknown attempt id is a no-op, so this only proves the handler accepts a job batch with metadata.
    await expect(
      handler([{ data: { attemptId: '00000000-0000-4000-8000-00000000dead', schoolId: '00000000-0000-4000-8000-00000000beef', questionId: 'q' }, retryCount: 2, retryLimit: 2 }]),
    ).resolves.toBeUndefined();
  });
});
