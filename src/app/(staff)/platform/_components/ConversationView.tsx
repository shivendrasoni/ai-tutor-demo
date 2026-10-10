import { Card } from '@/app/ui/components';
import type { MessageRow } from '@/modules/tutor/conversations';

const ROLE: Record<string, string> = { user: 'Student', assistant: 'Tutor' };

/** Plain-text rendering only: this is a minor's chat, so message content is never interpreted as HTML. */
export default function ConversationView({ messages, flaggedMessageId }: { messages: MessageRow[]; flaggedMessageId: string }) {
  return (
    <Card title="Conversation">
      <ol style={{ listStyle: 'none', padding: 0 }}>
        {messages.map((m) => {
          const flagged = m.id === flaggedMessageId;
          return (
            <li
              key={m.id}
              {...(flagged ? { 'data-flagged': 'true' } : {})}
              style={{ margin: '8px 0', padding: 8, whiteSpace: 'pre-wrap', background: flagged ? '#fef3c7' : undefined, border: flagged ? '2px solid #d97706' : '1px solid #e5e7eb' }}
            >
              <strong>{ROLE[m.role] ?? m.role}</strong> <small>{m.createdAt.toISOString()}</small>
              {flagged ? <> <strong>(flagged{m.flagReason ? `: ${m.flagReason}` : ''})</strong></> : null}
              <div>{m.content}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
