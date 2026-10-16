import { Flag } from 'lucide-react';
import { Card } from '@/app/ui/components';
import { cn } from '@/lib/utils';
import type { MessageRow } from '@/demo/areas/platform/types';

const ROLE: Record<string, string> = { user: 'Student', assistant: 'Tutor' };

/** Plain-text rendering only: this is a minor's chat, so message content is never interpreted as HTML. */
export default function ConversationView({ messages, flaggedMessageId }: { messages: MessageRow[]; flaggedMessageId: string }) {
  return (
    <Card title="Conversation">
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {messages.map((m) => {
          const flagged = m.id === flaggedMessageId;
          const student = m.role === 'user';
          return (
            <li
              key={m.id}
              {...(flagged ? { 'data-flagged': 'true' } : {})}
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl border px-4 py-2.5 text-sm',
                student ? 'self-end rounded-br-sm bg-primary/10' : 'self-start rounded-bl-sm bg-muted',
                flagged && 'border-2 border-warning bg-warning/15',
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <strong>{ROLE[m.role] ?? m.role}</strong>
                <small className="text-xs text-muted-foreground">{m.createdAt.slice(0, 16).replace('T', ' ')} UTC</small>
                {flagged ? (
                  <strong className="inline-flex items-center gap-1 text-destructive">
                    <Flag className="size-3.5" aria-hidden="true" />(flagged{m.flagReason ? `: ${m.flagReason}` : ''})
                  </strong>
                ) : null}
              </div>
              <div>{m.content}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
