export type GenerateJob = { artifactId: string; schoolId: string };
export type GradeJob = { attemptId: string; schoolId: string; questionId: string };
export type JobMeta = { retryCount: number; retryLimit: number };

/** Enqueue seam for study jobs. The pg-boss implementation arrives in Task 7; tests install a recording queue. */
export interface StudyQueue {
  enqueueGenerate(d: GenerateJob): Promise<void>;
  enqueueGrade(d: GradeJob[]): Promise<void>;
}

let current: StudyQueue | null = null;

export function setStudyQueue(q: StudyQueue | null): void {
  current = q;
}

export function getStudyQueue(): StudyQueue {
  if (!current) throw new Error('study queue is not configured');
  return current;
}
