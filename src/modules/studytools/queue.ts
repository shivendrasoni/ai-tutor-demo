import type { PgBoss } from 'pg-boss';
import { ensureQueue, getSendBoss, sendDeduped, type QueueSpec } from '@/lib/boss';
import { handleGenerateJob } from './generate';
import { handleGradeJob } from './grading';

export type GenerateJob = { artifactId: string; schoolId: string };
export type GradeJob = { attemptId: string; schoolId: string; questionId: string };
export type JobMeta = { retryCount: number; retryLimit: number };

export const GENERATE_QUEUE = 'studytools.generate';
export const GRADE_QUEUE = 'studytools.grade';
export const GRADE_CONCURRENCY = 4;
export const GENERATE_CONCURRENCY = 2;
// `stately` makes `singletonKey` real: at most one queued (created/retry) and one active job per key.
const JOB_OPTIONS = { retryLimit: 2, retryBackoff: true } as const;
const QUEUE_OPTIONS = { ...JOB_OPTIONS, policy: 'stately' } as const;
/** Handed to the worker's startup migration (the only place a queue policy may change). */
export const STUDY_QUEUE_SPECS: QueueSpec[] = [
  { name: GENERATE_QUEUE, options: { ...QUEUE_OPTIONS } },
  { name: GRADE_QUEUE, options: { ...QUEUE_OPTIONS } },
];
const gradeKey = (d: GradeJob): string => `${d.attemptId}:${d.questionId}`;

/** Enqueue seam for study jobs. Production uses PgBossQueue; tests install a recording queue. */
export interface StudyQueue {
  enqueueGenerate(d: GenerateJob): Promise<void>;
  enqueueGrade(d: GradeJob[]): Promise<void>;
}

async function startStudyBoss(): Promise<PgBoss> {
  const boss = await getSendBoss();
  await ensureQueue(boss, GENERATE_QUEUE, { ...QUEUE_OPTIONS });
  await ensureQueue(boss, GRADE_QUEUE, { ...QUEUE_OPTIONS });
  return boss;
}

export class PgBossQueue implements StudyQueue {
  private boss: Promise<PgBoss> | null = null;

  constructor(private readonly starter: () => Promise<PgBoss> = startStudyBoss) {}

  private async get(): Promise<PgBoss> {
    const starting = (this.boss ??= this.starter());
    try {
      return await starting;
    } catch (err) {
      // Do not cache a failed start: the next enqueue retries instead of failing until restart.
      if (this.boss === starting) this.boss = null;
      throw err;
    }
  }

  async enqueueGenerate(d: GenerateJob): Promise<void> {
    await sendDeduped(await this.get(), GENERATE_QUEUE, d, { ...JOB_OPTIONS, singletonKey: d.artifactId });
  }

  async enqueueGrade(d: GradeJob[]): Promise<void> {
    if (d.length === 0) return;
    await (await this.get()).insert(
      GRADE_QUEUE,
      d.map((data) => ({ data, ...JOB_OPTIONS, singletonKey: gradeKey(data) })),
    );
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = await this.boss;
    this.boss = null;
    await boss.stop();
  }
}

let current: StudyQueue | null = null;

export function setStudyQueue(q: StudyQueue | null): void {
  current = q;
}

/** Defaults to a lazily started PgBossQueue (no connection until the first enqueue). */
export function getStudyQueue(): StudyQueue {
  return (current ??= new PgBossQueue());
}

/** Registers both study workers on an already started boss (the ingest worker's). Installed pg-boss 12 `includeMetadata`. */
export async function registerStudyToolsWorkers(boss: Pick<PgBoss, 'createQueue' | 'getQueue' | 'work'>): Promise<void> {
  await ensureQueue(boss, GENERATE_QUEUE, { ...QUEUE_OPTIONS });
  await ensureQueue(boss, GRADE_QUEUE, { ...QUEUE_OPTIONS });
  await boss.work<GradeJob, void, { includeMetadata: true; localConcurrency: number }>(
    GRADE_QUEUE,
    { includeMetadata: true, localConcurrency: GRADE_CONCURRENCY },
    async (jobs) => {
      for (const j of jobs) await handleGradeJob({ data: j.data, retryCount: j.retryCount, retryLimit: j.retryLimit });
    },
  );
  await boss.work<GenerateJob, void, { includeMetadata: true; localConcurrency: number }>(
    GENERATE_QUEUE,
    { includeMetadata: true, localConcurrency: GENERATE_CONCURRENCY },
    async (jobs) => {
      for (const j of jobs) await handleGenerateJob({ data: j.data, retryCount: j.retryCount, retryLimit: j.retryLimit });
    },
  );
}
