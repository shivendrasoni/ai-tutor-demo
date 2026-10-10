'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR } from '@/app/(public)/_lib/api';
import { formatCitation, shouldRestoreDraft, streamMessage, type Citation } from '@/lib/sse-client';
import styles from '../../learn.module.css';

type Msg = { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; feedback: string | null };
type Streaming = { messageId: string | null; text: string; notice: string | null; citations: Citation[] };

const BUDGET_COPY = "You've reached today's limit. Come back tomorrow!";

function Citations({ items }: { items: Citation[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.citations} aria-label="Sources">
      {items.map((c) => (
        <li key={c.n} className={styles.cite}>[{c.n}] {formatCitation(c)}</li>
      ))}
    </ul>
  );
}

export default function ChatView({ conversationId }: { conversationId: string }) {
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

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
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
    <>
      <p className={styles.back}><Link href="/learn">‹ All chats</Link></p>
      {messages === null && !error && <p className={styles.hint} role="status">Loading…</p>}
      <div className={styles.thread} aria-live="polite">
        {messages?.map((m) => (
          <div key={m.id} className={m.role === 'user' ? styles.userRow : styles.botRow}>
            {m.role === 'assistant' && notices[m.id] && <p className={styles.notice}>{notices[m.id]}</p>}
            <div className={m.role === 'user' ? styles.userBubble : styles.botBubble}>{m.content}</div>
            {m.role === 'assistant' && <Citations items={m.citations} />}
            {m.role === 'assistant' && (
              <button
                type="button"
                className={styles.thumb}
                aria-label="Not helpful"
                title="Not helpful"
                disabled={rated[m.id] ?? m.feedback !== null}
                onClick={() => thumbsDown(m.id)}
              >
                👎
              </button>
            )}
          </div>
        ))}
        {pendingUser !== null && (
          <>
            <div className={styles.userRow}><div className={styles.userBubble}>{pendingUser}</div></div>
            {streaming && (
              <div className={styles.botRow}>
                {streaming.notice && <p className={styles.notice}>{streaming.notice}</p>}
                <div className={styles.botBubble} aria-busy="true">{streaming.text || '…'}</div>
                <Citations items={streaming.citations} />
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <form className={styles.composer} onSubmit={send}>
        <label className={styles.srOnly} htmlFor={inputId}>Your message</label>
        <textarea
          id={inputId}
          className={styles.textarea}
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
        <button type="submit" className={styles.primary} disabled={busy || !draft.trim()}>Send</button>
      </form>
    </>
  );
}
