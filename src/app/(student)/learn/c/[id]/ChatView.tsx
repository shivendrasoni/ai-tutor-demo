'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR } from '@/app/(public)/_lib/api';
import { formatCitation, shouldRestoreDraft, streamMessage, type Citation } from '@/lib/sse-client';
import Markdown from 'react-markdown';
import { SendHorizontal, ThumbsDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import Tutu, { type TutuMood } from '@/components/Tutu';
import { cn } from '@/lib/utils';
import { useStudent } from '../../../_components/StudentContext';
import { markdownClass } from '../../../_components/styles';

type Msg = { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; feedback: string | null };
type Streaming = { messageId: string | null; text: string; notice: string | null; citations: Citation[] };

const BUDGET_COPY = "You've reached today's limit. Come back tomorrow!";

function Citations({ items }: { items: Citation[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex max-w-full flex-wrap gap-1.5" aria-label="Sources">
      {items.map((c) => (
        <li key={c.n} className="max-w-full">
          <Badge variant="secondary" className="h-auto max-w-full whitespace-normal rounded-xl py-1 text-left font-normal">[{c.n}] {formatCitation(c)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-sm">{children}</p>
  );
}

function TutorAvatar({ mood = 'happy' }: { mood?: TutuMood }) {
  return (
    <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-accent">
      <Tutu mood={mood} className="size-9" />
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 py-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot size-2.5 rounded-full bg-primary/70" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

const STARTERS: Record<'junior' | 'middle' | 'senior', string[]> = {
  junior: ['Can you tell me something fun to learn?', 'Help me with my homework', 'Why is the sky blue?'],
  middle: ['Help me understand my homework', 'Explain this chapter simply', 'Quiz me on what I learned'],
  senior: ['Help me with a problem I am stuck on', 'Summarise this chapter for revision', 'Quiz me on a topic'],
};

const bubble = 'max-w-full rounded-3xl px-4 py-3 text-[0.95rem] leading-relaxed [overflow-wrap:anywhere]';
const userBubble = cn(bubble, 'max-w-[85%] whitespace-pre-wrap rounded-br-lg bg-primary text-primary-foreground shadow-sm');
const tutorBubble = cn(bubble, 'rounded-tl-lg border bg-[var(--student-bubble)]', markdownClass, 'text-[0.95rem]');

export default function ChatView({ conversationId }: { conversationId: string }) {
  const { band } = useStudent();
  const router = useRouter();
  const inputId = useId();
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = pendingUser !== null;

  const load = useCallback(async () => {
    const r = await apiFetch<Msg[]>(`/api/tutor/conversations/${conversationId}/messages`);
    if (r.ok) {
      setMessages(r.data);
      return true;
    }
    if (r.error.status === 401) router.replace('/login');
    else if (r.error.status === 403) router.replace('/status');
    else if (r.error.status === 404) router.replace('/learn');
    else setError(r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
    return false;
  }, [conversationId, router]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, pendingUser, streaming?.text]);

  function send(e: FormEvent) {
    e.preventDefault();
    void sendText(draft.trim());
  }

  async function sendText(text: string) {
    if (!text || busy) return;
    setDraft('');
    setError('');
    setPendingUser(text);
    setStreaming({ messageId: null, text: '', notice: null, citations: [] });
    const ctl = new AbortController();
    abortRef.current = ctl;
    let failed: { code: string; message: string; status: number } | null = null;
    let current: Streaming = { messageId: null, text: '', notice: null, citations: [] };
    const update = (patch: Partial<Streaming>) => {
      current = { ...current, ...patch };
      setStreaming(current);
    };
    await streamMessage(conversationId, text, {
      signal: ctl.signal,
      onMeta: (m) => update({ messageId: m.messageId, notice: m.notice ?? null }),
      onDelta: (t) => update({ text: current.text + t }),
      onCitations: (c) => update({ citations: c }),
      onError: (er) => {
        failed = er;
      },
    });
    if (ctl.signal.aborted) return;
    const f = failed as { code: string; message: string; status: number } | null;
    if (f?.status === 401) return router.replace('/login');
    if (f?.status === 403) return router.replace('/status');
    if (current.messageId && current.notice) {
      const { messageId, notice } = current;
      setNotices((n) => ({ ...n, [messageId]: notice }));
    }
    if (f) {
      setError(
        f.code === 'BUDGET_EXCEEDED' ? BUDGET_COPY
        : f.code === 'NETWORK' ? NETWORK_ERROR
        : f.code === 'TUTOR_BUSY' ? f.message
        : f.message || GENERIC_ERROR,
      );
      // Only if the server never stored the message (network/4xx); a 503 TUTOR_BUSY comes after it was stored.
      if (shouldRestoreDraft(f.status)) setDraft(text);
    }
    await load();
    setPendingUser(null);
    setStreaming(null);
  }

  async function thumbsDown(id: string) {
    setRated((r) => ({ ...r, [id]: true }));
    const r = await apiFetch(`/api/tutor/messages/${id}/feedback`, { method: 'POST', body: { rating: 'down' } });
    if (!r.ok) {
      setRated((s) => ({ ...s, [id]: false }));
      setError(r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
    }
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col">
      <p className="mb-4">
        <Link href="/learn" className="inline-flex items-center rounded-full bg-card px-3 py-1.5 text-sm font-bold text-primary no-underline shadow-xs ring-1 ring-border hover:no-underline">
          <span>‹ All chats</span>
        </Link>
      </p>
      {messages === null && !error && (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-16 w-3/4" />
        </div>
      )}
      {messages !== null && messages.length === 0 && !busy && (
        <div className="anim-pop flex flex-col items-center gap-4 py-8 text-center">
          <Tutu mood="happy" className="anim-float size-32" />
          <div>
            <p className="text-xl font-extrabold">What shall we learn?</p>
            <p className="text-muted-foreground">Type a question below, or tap one of these to begin.</p>
          </div>
          <ul className="flex flex-wrap justify-center gap-2" aria-label="Ideas">
            {STARTERS[band].map((t) => (
              <li key={t}>
                <button
                  type="button"
                  className="rounded-full border-2 border-primary/30 bg-card px-4 py-2 text-sm font-bold text-primary transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => void sendText(t)}
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4 pb-4" aria-live="polite">
        {messages?.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="anim-pop flex justify-end">
              <div className={userBubble}>{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="anim-pop flex items-start gap-2.5">
              <TutorAvatar />
              <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-2">
                {notices[m.id] && <Notice>{notices[m.id]}</Notice>}
                <div className={tutorBubble}><Markdown>{m.content}</Markdown></div>
                <Citations items={m.citations} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Not helpful"
                  title="Not helpful"
                  disabled={rated[m.id] ?? m.feedback !== null}
                  onClick={() => thumbsDown(m.id)}
                >
                  <ThumbsDown />
                </Button>
              </div>
            </div>
          ),
        )}
        {pendingUser !== null && (
          <>
            <div className="anim-pop flex justify-end">
              <div className={userBubble}>{pendingUser}</div>
            </div>
            {streaming && (
              <div className="flex items-start gap-2.5">
                <TutorAvatar mood="thinking" />
                <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-2">
                  {streaming.notice && <Notice>{streaming.notice}</Notice>}
                  <div className={tutorBubble} aria-busy="true">{streaming.text ? <Markdown>{streaming.text}</Markdown> : <TypingDots />}</div>
                  <Citations items={streaming.citations} />
                </div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>
      {error && (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form
        className="sticky bottom-[5.75rem] z-20 -mx-4 flex items-end gap-2 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-2 pt-4 sm:bottom-0"
        onSubmit={send}
      >
        <Label htmlFor={inputId} className="sr-only">Your message</Label>
        <Textarea
          id={inputId}
          className="max-h-40 min-h-12 resize-none rounded-3xl border-2 bg-card px-4 py-3 text-base shadow-sm"
          placeholder="Type your question…"
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" size="icon-lg" className="btn-chunky size-12 shrink-0 rounded-full" disabled={busy || !draft.trim()}>
          <SendHorizontal />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}
