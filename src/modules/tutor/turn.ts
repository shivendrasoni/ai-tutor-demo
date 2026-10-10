import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { conversations, messages, schools, skills } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { studentScope } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy/authz';
import { CitationTracker, parseCitations, type Citation } from './citations';
import { isUuid } from './conversations';
import { getDeps } from './deps';
import { sanitizeAnswers, type DeciderAnswer, type DeciderRun } from './decider/types';
import { computeCost } from './models/pricing';
import { buildInstructions } from './prompt';
import {
  buildQuestions,
  chapterQuestion,
  needsChapterCall,
  routeTurn,
  topSubjectsForChapters,
} from './routing';
import type { TutorTool } from './runner/types';
import { getSkillByKey, type SkillRow } from './skills';
import { createSearchCurriculumTool } from './tools/search-curriculum';
import { isBudgetExhausted, recordUsage } from './usage';

export type TurnEvent =
  | { type: 'meta'; data: { messageId: string; skill: string; modelTier: 'standard' | 'advanced'; notice?: string } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'citations'; data: { citations: Citation[] } }
  | { type: 'done'; data: { tokensIn: number; tokensOut: number } }
  | { type: 'error'; data: { code: string; message: string } };

export const MAX_MESSAGE_CHARS = 4000;
const HISTORY_LIMIT = 20;
const DECIDER_STATE_HISTORY = 4;
const MAX_STEPS = 5;

export const FIXED_REPLIES = {
  off_topic: "I'm here to help with your studies. Ask me anything about your subjects!",
  unsafe:
    "I can't help with that. If something is worrying you, please talk to a parent, teacher, or another adult you trust.",
} as const;
export const SOCRATIC_NOTICE = "I'll guide you step by step so you can work this out yourself.";
const BUSY_MESSAGE = 'The tutor is busy right now. Please try again in a moment.';
const BUDGET_MESSAGE = "You've reached today's study limit. Please come back tomorrow.";

type Turn = { role: 'user' | 'assistant'; content: string };
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

/**
 * One tutor turn. Every DB step is its own short transaction; nothing is held open while streaming.
 * Pre-stream failures (FORBIDDEN, NOT_FOUND, VALIDATION) throw on the first next().
 */
export async function* runTurn(
  actor: Actor,
  conversationId: string,
  text: string,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<TurnEvent> {
  const deps = getDeps();
  const startedAt = Date.now();
  const userText = typeof text === 'string' ? text.trim() : '';
  if (!userText) throw new DomainError('VALIDATION', 'Message is empty');
  if (userText.length > MAX_MESSAGE_CHARS) throw new DomainError('VALIDATION', 'Message is too long');

  // 1. Validate, load context, check budget (checked only here, never mid-turn).
  const scope = await studentScope(actor);
  if (!isUuid(conversationId)) throw new DomainError('NOT_FOUND');
  const ctx = await runAs(actor, async (tx) => {
    const [row] = await tx
      .select({ skill: skills, schoolName: schools.name })
      .from(conversations)
      .innerJoin(skills, eq(skills.id, conversations.skillId))
      .innerJoin(schools, eq(schools.id, conversations.schoolId))
      .where(and(eq(conversations.id, conversationId), eq(conversations.studentId, actor.userId)));
    if (!row) return null;
    return { ...row, exhausted: await isBudgetExhausted(tx, actor.userId, deps.now()) };
  });
  if (!ctx) throw new DomainError('NOT_FOUND');
  if (ctx.exhausted) {
    yield { type: 'error', data: { code: 'BUDGET_EXCEEDED', message: BUDGET_MESSAGE } };
    return;
  }
  const convSkill: SkillRow = {
    ...ctx.skill,
    kind: ctx.skill.kind as SkillRow['kind'],
    models: (ctx.skill.models ?? {}) as SkillRow['models'],
  };

  // 2. Persist the user message at once (kept on any failure) and set the title if still empty.
  const userMsg = await runAs(actor, async (tx) => {
    const [m] = await tx
      .insert(messages)
      .values({ schoolId: scope.schoolId, conversationId, role: 'user', content: userText })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    await tx
      .update(conversations)
      .set({ title: sql`left(${userText}, 60)` })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.title)));
    return m;
  });

  // 3. History: the last 20 messages before this one, oldest first.
  const historyRows = await runAs(actor, (tx) =>
    tx
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          or(
            lt(messages.createdAt, userMsg.createdAt),
            and(eq(messages.createdAt, userMsg.createdAt), lt(messages.id, userMsg.id)),
          ),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(HISTORY_LIMIT),
  );
  const history: Turn[] = historyRows.reverse().map((r) => ({ role: r.role as Turn['role'], content: r.content }));
  const state = [...history.slice(-DECIDER_STATE_HISTORY), { role: 'user' as const, content: userText }]
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  // 4. Decide. Any failure means "no answers" (defaults apply).
  const subjects = await deps.content.subjects(scope).catch(() => []);
  let answers: Record<string, DeciderAnswer> = {};
  let chapters: { id: string; title: string }[] = [];
  let deciderError = false;
  let deciderFellBack = false;
  const decideStart = Date.now();
  if (deps.decider) {
    try {
      const questions = buildQuestions({ grade: scope.grade, subjects });
      const run: DeciderRun = { fellBack: false, primaryError: false, secondaryError: false };
      const first = sanitizeAnswers(questions, await deps.decider.decide(state, questions, run));
      deciderFellBack = run.fellBack;
      const subjectIds = subjects.map((s) => s.id);
      let merged = first;
      if (needsChapterCall(first, subjectIds)) {
        const lists = await Promise.all(topSubjectsForChapters(first, subjectIds).map((id) => deps.content.chapters(scope, id)));
        chapters = lists.flat().map((c) => ({ id: c.id, title: c.title }));
        if (chapters.length > 0) {
          const cq = chapterQuestion(chapters);
          const run2: DeciderRun = { fellBack: false, primaryError: false, secondaryError: false };
          merged = { ...first, ...sanitizeAnswers(cq, await deps.decider.decide(state, cq, run2)) };
          deciderFellBack = deciderFellBack || run2.fellBack;
        }
      }
      answers = merged;
    } catch (e) {
      console.error('[tutor] decider failed', e);
      answers = {};
      chapters = [];
      deciderError = true;
    }
  }
  const deciderLatencyMs = Date.now() - decideStart;

  const route = routeTurn(answers, {
    skillKey: convSkill.key,
    subjectIds: subjects.map((s) => s.id),
    chapterIds: chapters.map((c) => c.id),
  });
  const baseDecisions = {
    answers: route.decisions.answers,
    tier: route.tier,
    fixedReply: route.fixedReply ?? null,
    deciderProvider: deps.decider ? deps.deciderProvider : ('none' as const),
    deciderError,
    deciderFellBack,
    latencyMs: deciderLatencyMs,
  };
  const messageId = randomUUID();

  const persistAssistant = (v: {
    content: string;
    citations: Citation[];
    retrievedChunkIds: string[];
    decisions: Record<string, unknown>;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    cost: number | null;
    flagged: boolean;
    flagReason: string | null;
  }) =>
    runAs(actor, async (tx) => {
      await tx.insert(messages).values({
        id: messageId,
        schoolId: scope.schoolId,
        conversationId,
        role: 'assistant',
        content: v.content,
        citations: v.citations,
        retrievedChunkIds: v.retrievedChunkIds,
        decisions: v.decisions,
        model: v.model,
        modelTier: v.model ? route.tier : null,
        tokensIn: v.tokensIn,
        tokensOut: v.tokensOut,
        cost: v.cost === null ? null : String(v.cost),
        latencyMs: Date.now() - startedAt,
        flagged: v.flagged,
        flagReason: v.flagged ? v.flagReason : null,
      });
      const now = deps.now();
      await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId));
      if (v.tokensIn + v.tokensOut > 0) {
        await recordUsage(tx, { schoolId: scope.schoolId, studentId: actor.userId, tokens: v.tokensIn + v.tokensOut, cost: v.cost, now });
      }
    });

  // 5. Fixed replies: no model call.
  if (route.fixedReply) {
    const reply = FIXED_REPLIES[route.fixedReply];
    await persistAssistant({
      content: reply,
      citations: [],
      retrievedChunkIds: [],
      decisions: { ...baseDecisions, filterFallback: false, aborted: false },
      model: null,
      tokensIn: 0,
      tokensOut: 0,
      cost: null,
      flagged: route.fixedReply === 'unsafe' || route.needsReview,
      flagReason: route.fixedReply === 'unsafe' ? 'unsafe' : 'decider_review',
    });
    yield { type: 'meta', data: { messageId, skill: convSkill.key, modelTier: route.tier } };
    yield { type: 'delta', data: { text: reply } };
    yield { type: 'citations', data: { citations: [] } };
    yield { type: 'done', data: { tokensIn: 0, tokensOut: 0 } };
    return;
  }

  // 6. Answer with the agent.
  let skill = convSkill;
  if (route.switchedToSocratic) {
    const s = await getSkillByKey(route.effectiveSkillKey);
    if (s?.enabled) skill = s;
  }
  const switched = skill.key !== convSkill.key;
  const instructions = buildInstructions({
    skillInstructions: skill.instructions,
    grade: scope.grade,
    schoolName: ctx.schoolName,
    outOfSyllabus: route.outOfSyllabus,
  });
  const tracker = new CitationTracker();
  const tools: TutorTool[] = skill.tools.includes('search_curriculum')
    ? [
        createSearchCurriculumTool({
          scope,
          search: deps.content.search,
          routed: { subjectIds: route.subjectIds, chapterIds: route.chapterIds },
          subjects,
          chapters,
          tracker,
        }),
      ]
    : [];

  let spec: string;
  let model;
  try {
    spec = deps.registry.specFor(skill, route.tier);
    model = deps.registry.resolve(spec);
  } catch (e) {
    console.error('[tutor] model not available', e);
    yield { type: 'error', data: { code: 'TUTOR_BUSY', message: BUSY_MESSAGE } };
    return;
  }

  const internal = new AbortController();
  const onAbort = () => internal.abort();
  if (opts.signal?.aborted) internal.abort();
  else opts.signal?.addEventListener('abort', onAbort, { once: true });

  let full = '';
  let usage: { tokensIn: number; tokensOut: number } | null = null;
  let failed = false;
  let finished = false; // reached the end of the stream normally
  let abortedOut = false;
  let citationsOut: Citation[] = [];
  let usageOut = { tokensIn: 0, tokensOut: 0 };
  try {
    yield {
      type: 'meta',
      data: { messageId, skill: skill.key, modelTier: route.tier, ...(switched ? { notice: SOCRATIC_NOTICE } : {}) },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        for await (const ev of deps.runner.run({
          instructions,
          model,
          history,
          userText,
          tools,
          maxSteps: MAX_STEPS,
          signal: internal.signal,
          providerOptions: skill.providerOptions ?? undefined,
        })) {
          if (ev.type === 'delta') {
            full += ev.text;
            yield { type: 'delta', data: { text: ev.text } };
            if (internal.signal.aborted) break; // signal fired while the consumer held the delta
          } else usage = ev.usage;
        }
        finished = !internal.signal.aborted;
        break;
      } catch (e) {
        if (internal.signal.aborted) break; // client abort, not a provider failure
        const notConfigured = e instanceof Error && e.message.startsWith('MODEL_NOT_CONFIGURED');
        console.error('[tutor] runner failed', e);
        // Retry only if nothing was streamed yet (never double-emit deltas).
        if (full.length > 0 || notConfigured || attempt === 1) {
          failed = true;
          break;
        }
      }
    }
  } finally {
    // Runs on normal end, failure, client abort (generator return) and signal abort: always persists.
    opts.signal?.removeEventListener('abort', onAbort);
    const aborted = !finished && !failed;
    internal.abort();
    if (full.length > 0 || finished) {
      const tokensIn = usage?.tokensIn ?? estimateTokens(instructions.length + history.reduce((n, m) => n + m.content.length, 0) + userText.length);
      const tokensOut = usage?.tokensOut ?? estimateTokens(full.length);
      citationsOut = parseCitations(full, tracker);
      usageOut = { tokensIn: Math.ceil(tokensIn), tokensOut: Math.ceil(tokensOut) };
      await persistAssistant({
        content: full,
        citations: citationsOut,
        retrievedChunkIds: tracker.allChunkIds(),
        decisions: { ...baseDecisions, filterFallback: tracker.filterFallback, aborted },
        model: spec,
        tokensIn: usageOut.tokensIn,
        tokensOut: usageOut.tokensOut,
        cost: computeCost(spec, usageOut.tokensIn, usageOut.tokensOut),
        flagged: route.needsReview,
        flagReason: 'decider_review',
      });
    }
    abortedOut = aborted;
  }

  if (failed) {
    yield { type: 'error', data: { code: 'TUTOR_BUSY', message: BUSY_MESSAGE } };
    return;
  }
  if (abortedOut) return;
  yield { type: 'citations', data: { citations: citationsOut } };
  yield { type: 'done', data: usageOut };
}
