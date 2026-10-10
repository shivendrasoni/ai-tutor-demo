import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { schools } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { studentScope, type ChunkHit } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy/authz';
import { getDeps } from './deps';
import { computeCost } from './models/pricing';
import type { ModelTier } from './models/registry';
import { buildInstructions } from './prompt';
import { getSkillByKey } from './skills';
import { isBudgetExhausted, recordUsage } from './usage';

const BUSY_MESSAGE = 'The tutor is busy right now. Please try again in a moment.';
const NO_TOOLS_SUFFIX = 'The passages are provided below. Do not call tools.';

export type StructuredUsage = { tokensIn: number; tokensOut: number; cost: number | null; model: string };

const formatContext = (context: ChunkHit[] | string): string =>
  typeof context === 'string'
    ? context
    : context
        .map((h, i) => `[${i + 1}] ${h.itemTitle} · ${h.chapterTitle} · p. ${h.pageStart}–${h.pageEnd}\n${h.text}`)
        .join('\n\n');

const int = (n: number | undefined) => Math.max(0, Math.ceil(n ?? 0));

/**
 * One-shot structured generation for study tools (quiz, flashcards, grading...). No Mastra, no tools.
 * Validates against `schema` with one repair attempt; usage is recorded for every model call.
 * `skipBudget` (default false) skips the pre-check only; usage is still recorded.
 */
export async function runSkillStructured<T>(
  actor: Actor,
  skillKey: string,
  a: { tier: ModelTier; prompt: string; schema: ZodType<T>; context: ChunkHit[] | string; skipBudget?: boolean },
): Promise<{ value: T; usage: StructuredUsage }> {
  const deps = getDeps();
  const scope = await studentScope(actor);
  const skill = await getSkillByKey(skillKey);
  if (!skill || !skill.enabled) throw new DomainError('NOT_FOUND');

  const ctx = await runAs(actor, async (tx) => {
    const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, scope.schoolId));
    const exhausted = a.skipBudget ? false : await isBudgetExhausted(tx, actor.userId, deps.now());
    return { schoolName: school?.name ?? '', exhausted };
  });
  if (ctx.exhausted) throw new DomainError('BUDGET_EXCEEDED');

  let spec: string;
  let model;
  try {
    spec = deps.registry.specFor(skill, a.tier);
    model = deps.registry.resolve(spec);
  } catch (e) {
    console.error('[tutor] model not available', e);
    throw new DomainError('TUTOR_BUSY', BUSY_MESSAGE);
  }

  const system =
    buildInstructions({ skillInstructions: skill.instructions, grade: scope.grade, schoolName: ctx.schoolName, outOfSyllabus: false }) +
    '\n\n' +
    NO_TOOLS_SUFFIX;
  const basePrompt = `${a.prompt}\n\nPassages:\n${formatContext(a.context) || '(none)'}`;

  let tokensIn = 0;
  let tokensOut = 0;
  const record = async (u: { inputTokens?: number; outputTokens?: number } | undefined) => {
    const i = int(u?.inputTokens);
    const o = int(u?.outputTokens);
    if (i + o === 0) return;
    tokensIn += i;
    tokensOut += o;
    await runAs(actor, (tx) =>
      recordUsage(tx, { schoolId: scope.schoolId, studentId: actor.userId, tokens: i + o, cost: computeCost(spec, i, o), now: deps.now() }),
    );
  };

  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    let schemaError: string | null = null;
    let value: T | undefined;
    let succeeded = false;
    // Provider errors: one retry, then TUTOR_BUSY. Usage recording happens outside this handling.
    let res: Awaited<ReturnType<typeof generateText>> | undefined;
    let failedUsage: { inputTokens?: number; outputTokens?: number } | undefined;
    for (let tries = 0; ; tries++) {
      try {
        res = await generateText({ model, system, prompt, output: Output.object({ schema: a.schema }), temperature: 0, maxRetries: 0, providerOptions: skill.providerOptions as never });
        break;
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) {
          failedUsage = e.usage;
          schemaError = e.cause instanceof Error ? e.cause.message : e.message;
          break;
        }
        console.error('[tutor] structured generation failed', e);
        if (tries === 1) throw new DomainError('TUTOR_BUSY', BUSY_MESSAGE);
      }
    }
    await record(res ? res.usage : failedUsage);
    if (res) {
      value = res.output as T;
      succeeded = true;
    }
    if (succeeded) {
      return { value: value as T, usage: { tokensIn, tokensOut, cost: computeCost(spec, tokensIn, tokensOut), model: spec } };
    }
    if (attempt === 1) throw new DomainError('VALIDATION', `Model output did not match the schema: ${schemaError}`);
    prompt = `${basePrompt}\n\nYour previous answer did not match the required schema: ${schemaError}\nReturn corrected output that matches the schema exactly.`;
  }
  throw new DomainError('VALIDATION'); // unreachable
}
