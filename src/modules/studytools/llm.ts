import { z } from 'zod';
import type { ChunkHit } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { runSkillStructured, type ModelTier, type StructuredUsage } from '@/modules/tutor';
import { formatPassages } from './prompts';
import { clampScore } from './scoring';
import type { ArtifactType, MockExam, Notes, PracticeTest } from './schemas';
import { generatedSchemaFor, type ValidationCtx } from './validate';

export const SKILL_FOR_TYPE: Record<ArtifactType, string> = {
  practice_test: 'practice_test_generator',
  mock_exam: 'mock_exam_generator',
  study_notes: 'study_notes_generator',
  last_night_notes: 'last_night_notes_generator',
};

export const tierFor = (type: ArtifactType): ModelTier => (type === 'mock_exam' ? 'advanced' : 'standard');

/** Generation is governed by the daily generation limit, so the chat token budget is skipped. */
export function callGenerator(
  actor: Actor,
  a: { type: ArtifactType; prompt: string; hits: ChunkHit[]; ctx: ValidationCtx },
): Promise<{ value: PracticeTest | MockExam | Notes; usage: StructuredUsage }> {
  return runSkillStructured(actor, SKILL_FOR_TYPE[a.type], {
    tier: tierFor(a.type),
    prompt: a.prompt,
    schema: generatedSchemaFor(a.type, a.ctx),
    context: formatPassages(a.hits),
    skipBudget: true,
  });
}

const GradeSchema = z.object({ score: z.number(), feedback: z.string() });
const MAX_FEEDBACK_WORDS = 60;

export async function callGrader(actor: Actor, prompt: string, marks: number): Promise<{ score: number; feedback: string }> {
  const { value } = await runSkillStructured(actor, 'answer_grader', {
    tier: 'standard',
    prompt,
    schema: GradeSchema,
    context: '',
    skipBudget: true,
  });
  return {
    score: clampScore(value.score, marks),
    feedback: value.feedback.trim().split(/\s+/).slice(0, MAX_FEEDBACK_WORDS).join(' '),
  };
}
