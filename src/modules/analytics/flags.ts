import { sql } from 'drizzle-orm';
import { withPlatform } from '@/db/client';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy/actor';
import { requirePlatform } from '@/modules/tenancy/authz';
import { isUuid, type MessageRow } from '@/modules/tutor/conversations';

export type FlaggedRow = {
  messageId: string;
  conversationId: string;
  schoolName: string;
  studentName: string;
  reason: string | null;
  excerpt: string;
  createdAt: Date;
};

const EXCERPT = 160;

/** Platform-only. Flagged messages, newest first, max 200. `open` = not yet reviewed. */
export async function listFlagged(actor: Actor, args: { status: 'open' | 'reviewed' }): Promise<FlaggedRow[]> {
  requirePlatform(actor);
  const status = args?.status;
  if (status !== 'open' && status !== 'reviewed') throw new DomainError('VALIDATION', 'status must be open or reviewed');
  const cond = status === 'open' ? sql`m.reviewed_at is null` : sql`m.reviewed_at is not null`;
  return withPlatform(async (tx) => {
    const res = await tx.execute(sql`
      select m.id as "messageId", m.conversation_id as "conversationId", s.name as "schoolName",
        u.name as "studentName", m.flag_reason as "reason", m.content as "content", m.created_at as "createdAt"
      from messages m
      join conversations c on c.id = m.conversation_id
      join users u on u.id = c.student_id
      join schools s on s.id = c.school_id
      where m.flagged = true and ${cond}
      order by m.created_at desc, m.id desc
      limit 200`);
    return res.rows.map((r) => {
      const content = r.content as string;
      const chars = Array.from(content);
      return {
        messageId: r.messageId as string,
        conversationId: r.conversationId as string,
        schoolName: r.schoolName as string,
        studentName: r.studentName as string,
        reason: (r.reason as string | null) ?? null,
        excerpt: chars.length > EXCERPT ? `${chars.slice(0, EXCERPT).join('')}…` : content,
        createdAt: new Date(r.createdAt as string | Date),
      };
    });
  });
}

/** Platform-only. The whole conversation containing a flagged message, in (created_at, id) order. */
export async function getFlaggedConversation(
  actor: Actor,
  messageId: string,
): Promise<{ messages: MessageRow[]; flaggedMessageId: string; reviewedAt: Date | null; reviewedBy: string | null }> {
  requirePlatform(actor);
  if (!isUuid(messageId)) throw new DomainError('NOT_FOUND');
  const rows = await withPlatform(async (tx) => {
    const res = await tx.execute(sql`
      select m2.id, m2.conversation_id as "conversationId", m2.role, m2.content, m2.citations,
        m2.retrieved_chunk_ids as "retrievedChunkIds", m2.decisions, m2.model, m2.model_tier as "modelTier",
        m2.tokens_in as "tokensIn", m2.tokens_out as "tokensOut", m2.cost, m2.latency_ms as "latencyMs",
        m2.flagged, m2.flag_reason as "flagReason", m2.feedback, m2.created_at as "createdAt",
        f.reviewed_at as "reviewedAt", f.reviewed_by as "reviewedBy"
      from messages f
      join messages m2 on m2.conversation_id = f.conversation_id
      where f.id = ${messageId} and f.flagged = true
      order by m2.created_at, m2.id`);
    return res.rows;
  });
  if (!rows.length) throw new DomainError('NOT_FOUND');
  return {
    flaggedMessageId: messageId,
    reviewedAt: rows[0].reviewedAt ? new Date(rows[0].reviewedAt as string | Date) : null,
    reviewedBy: (rows[0].reviewedBy as string | null) ?? null,
    messages: rows.map((r) => ({
      id: r.id as string,
      conversationId: r.conversationId as string,
      role: r.role as MessageRow['role'],
      content: r.content as string,
      citations: (r.citations ?? []) as MessageRow['citations'],
      retrievedChunkIds: (r.retrievedChunkIds ?? []) as string[],
      decisions: (r.decisions ?? null) as MessageRow['decisions'],
      model: (r.model as string | null) ?? null,
      modelTier: (r.modelTier as string | null) ?? null,
      tokensIn: Number(r.tokensIn),
      tokensOut: Number(r.tokensOut),
      cost: r.cost == null ? null : String(r.cost),
      latencyMs: r.latencyMs == null ? null : Number(r.latencyMs),
      flagged: r.flagged as boolean,
      flagReason: (r.flagReason as string | null) ?? null,
      feedback: (r.feedback as string | null) ?? null,
      createdAt: new Date(r.createdAt as string | Date),
    })),
  };
}

/** Platform-only, idempotent: a repeat call keeps the original reviewed_at / reviewed_by. */
export async function markReviewed(actor: Actor, messageId: string): Promise<void> {
  requirePlatform(actor);
  if (!isUuid(messageId)) throw new DomainError('NOT_FOUND');
  const res = await withPlatform((tx) =>
    tx.execute(sql`
      update messages
      set reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, ${actor.userId})
      where id = ${messageId} and flagged = true
      returning id`),
  );
  if (!res.rows.length) throw new DomainError('NOT_FOUND');
}
