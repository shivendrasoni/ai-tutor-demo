import { and, eq } from 'drizzle-orm';
import { withPlatform, withTenant } from '@/db/client';
import { artifacts } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { chunksForChapters, studentScope } from '@/modules/content';
import { loadActor } from '@/modules/tenancy';
import { callGenerator } from './llm';
import { defaultPatternKey, getPattern, type ExamPatternRow } from './patterns';
import { buildGeneratorPrompt } from './prompts';
import type { ArtifactType } from './schemas';
import type { GenerateJob, JobMeta } from './queue';
import { resolvePassageRefs } from './validate';

const CONTEXT_TOKENS = 24000;
const DEFAULT_QUESTION_COUNT = 10;

type Params = { questionCount?: number; patternKey?: string; chapterTitles?: Record<string, string> };

/** Marks a still-`generating` artifact failed. The status guard keeps a redelivered job from clobbering a result. */
const markFailed = (schoolId: string, artifactId: string): Promise<unknown> =>
  withTenant(schoolId, (tx) =>
    tx
      .update(artifacts)
      .set({ status: 'failed', error: 'GENERATION_FAILED', content: null })
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.status, 'generating'))),
  );

/**
 * Runs as the system on behalf of the artifact's student. Not `generating` (ready, failed, deleted, wrong school) is a no-op.
 * Permanent failures mark the artifact failed; transient ones rethrow for pg-boss until the final attempt.
 */
export async function handleGenerateJob(job: { data: GenerateJob } & Partial<JobMeta>): Promise<void> {
  const { artifactId, schoolId } = job.data;
  const [artifact] = await withTenant(schoolId, (tx) =>
    tx.select().from(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.schoolId, schoolId))),
  );
  if (!artifact || artifact.status !== 'generating') return;

  const isFinalAttempt = (job.retryCount ?? 0) >= (job.retryLimit ?? 0);
  try {
    const actor = await withPlatform((tx) => loadActor(tx, artifact.studentId));
    if (!actor) return void (await markFailed(schoolId, artifactId));
    const scope = await studentScope(actor);

    const hits = await chunksForChapters(scope, artifact.chapterIds, CONTEXT_TOKENS);
    if (hits.length === 0) return void (await markFailed(schoolId, artifactId));

    const type = artifact.type as ArtifactType;
    const params = artifact.params as Params;
    let pattern: ExamPatternRow | undefined;
    if (type === 'mock_exam') {
      pattern = (await getPattern(params.patternKey ?? defaultPatternKey(scope.grade))) ?? undefined;
      if (!pattern) return void (await markFailed(schoolId, artifactId));
    }
    const questionCount = type === 'practice_test' ? (params.questionCount ?? DEFAULT_QUESTION_COUNT) : undefined;
    const prompt = buildGeneratorPrompt({
      type,
      grade: scope.grade,
      chapters: artifact.chapterIds.map((id) => ({ id, title: params.chapterTitles?.[id] ?? hits.find((h) => h.chapterId === id)?.chapterTitle ?? id })),
      questionCount,
      pattern,
    });

    const { value } = await callGenerator(actor, {
      type,
      prompt,
      hits,
      ctx: { type, chapterIds: artifact.chapterIds, passageCount: hits.length, questionCount, pattern },
    });
    const { content, sourceChunkIds } = resolvePassageRefs(value, hits);
    await withTenant(schoolId, (tx) =>
      tx
        .update(artifacts)
        .set({ status: 'ready', error: null, content, sourceChunkIds })
        .where(and(eq(artifacts.id, artifactId), eq(artifacts.status, 'generating'))),
    );
  } catch (e) {
    const permanent = e instanceof DomainError && (e.code === 'VALIDATION' || e.code === 'FORBIDDEN');
    if (permanent || isFinalAttempt) {
      await markFailed(schoolId, artifactId);
      return;
    }
    throw e;
  }
}
