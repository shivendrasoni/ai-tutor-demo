import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { messages, conversations, skills } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { studentScope } from '@/modules/content';
import type { Actor } from '@/modules/tenancy/actor';
import { runAs } from '@/modules/tenancy/authz';
import { getDeps } from './deps';
import type { Citation } from './citations';
import { getSkillByKey } from './skills';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export type MessageRow = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  retrievedChunkIds: string[];
  decisions: Record<string, unknown> | null;
  model: string | null;
  modelTier: string | null;
  tokensIn: number;
  tokensOut: number;
  cost: string | null;
  latencyMs: number | null;
  flagged: boolean;
  flagReason: string | null;
  feedback: string | null;
  createdAt: Date;
};

const toMessage = (m: typeof messages.$inferSelect): MessageRow => ({
  id: m.id,
  conversationId: m.conversationId,
  role: m.role as MessageRow['role'],
  content: m.content,
  citations: (m.citations ?? []) as Citation[],
  retrievedChunkIds: m.retrievedChunkIds,
  decisions: (m.decisions ?? null) as MessageRow['decisions'],
  model: m.model,
  modelTier: m.modelTier,
  tokensIn: m.tokensIn,
  tokensOut: m.tokensOut,
  cost: m.cost,
  latencyMs: m.latencyMs,
  flagged: m.flagged,
  flagReason: m.flagReason,
  feedback: m.feedback,
  createdAt: m.createdAt,
});

export async function createConversation(
  actor: Actor,
  a: { skillKey: string; subjectId?: string },
): Promise<{ id: string }> {
  const scope = await studentScope(actor); // FORBIDDEN unless an active student
  const skill = await getSkillByKey(a.skillKey);
  if (!skill || !skill.enabled || skill.kind !== 'chat') throw new DomainError('VALIDATION', 'Unknown skill');
  if (a.subjectId !== undefined) {
    const visible = await getDeps().content.subjects(scope);
    if (!visible.some((s) => s.id === a.subjectId)) throw new DomainError('VALIDATION', 'Unknown subject');
  }
  const [row] = await runAs(actor, (tx) =>
    tx
      .insert(conversations)
      .values({ schoolId: scope.schoolId, studentId: actor.userId, skillId: skill.id, subjectId: a.subjectId ?? null })
      .returning({ id: conversations.id }),
  );
  return { id: row.id };
}

/** Subjects with content visible to the active student (for the new-chat subject picker). */
export async function listChatSubjects(actor: Actor): Promise<{ id: string; name: string }[]> {
  const scope = await studentScope(actor);
  return getDeps().content.subjects(scope);
}

export async function listConversations(
  actor: Actor,
): Promise<{ id: string; title: string | null; skillKey: string; subjectId: string | null; updatedAt: Date }[]> {
  return runAs(actor, (tx) =>
    tx
      .select({
        id: conversations.id,
        title: conversations.title,
        skillKey: skills.key,
        subjectId: conversations.subjectId,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(skills, eq(skills.id, conversations.skillId))
      .where(eq(conversations.studentId, actor.userId))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id)),
  );
}

export async function getMessages(actor: Actor, conversationId: string): Promise<MessageRow[]> {
  if (!isUuid(conversationId)) throw new DomainError('NOT_FOUND');
  const rows = await runAs(actor, async (tx) => {
    const [c] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.studentId, actor.userId)));
    if (!c) return null;
    return tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
  });
  if (!rows) throw new DomainError('NOT_FOUND');
  return rows.map(toMessage);
}

const MAX_COMMENT = 2000;

/** Flags the student's own assistant message for review. A reason already set (e.g. `unsafe`) is kept. */
export async function submitFeedback(
  actor: Actor,
  messageId: string,
  a: { rating: 'down'; comment?: string },
): Promise<void> {
  if (!isUuid(messageId)) throw new DomainError('NOT_FOUND');
  const comment = a.comment?.trim().slice(0, MAX_COMMENT);
  const updated = await runAs(actor, (tx) =>
    tx
      .update(messages)
      .set({
        flagged: true,
        flagReason: sql`coalesce(${messages.flagReason}, 'student_feedback')`,
        feedback: comment || 'down',
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.role, 'assistant'),
          inArray(
            messages.conversationId,
            tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.studentId, actor.userId)),
          ),
        ),
      )
      .returning({ id: messages.id }),
  );
  if (updated.length === 0) throw new DomainError('NOT_FOUND');
}
