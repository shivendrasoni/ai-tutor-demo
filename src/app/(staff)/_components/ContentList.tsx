'use client';

import { useEffect, useState } from 'react';
import type { ContentItemRow, IngestStatus } from '@/modules/content';
// Direct import (not the module index) so the client bundle does not pull in server code.
import { STUCK_INGEST_AFTER_MS } from '@/modules/content/stuck';
import styles from '../staff.module.css';

type Props = { initialItems: ContentItemRow[]; toggleBranchId: string | null };

const POLL_MS = 3000;
const LABEL: Record<IngestStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};
const SCOPE: Record<string, string> = { school: 'Whole school', branch: 'Branch', section: 'Section' };

/**
 * Queued/processing with no status change (`updatedAt`, the same timestamp `retryIngest` checks) for over 15 min:
 * Retry is offered. A live job cannot be known client-side, so the server may still refuse (see `retryErrorMessage`).
 */
export const isStuckCandidate = (i: Pick<ContentItemRow, 'status' | 'updatedAt'>, now = Date.now()) =>
  (i.status === 'queued' || i.status === 'processing') && now - new Date(i.updatedAt).getTime() > STUCK_INGEST_AFTER_MS;

const RETRY_FAILED = 'Could not retry. Please try again.';
/** The server's own message for a refused retry (e.g. a job is still live), else a generic one. */
export function retryErrorMessage(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message.trim() ? message : RETRY_FAILED;
}
const inFlight = (items: ContentItemRow[]) => items.some((i) => i.status === 'queued' || i.status === 'processing');

async function post(path: string, body: unknown, onError?: (res: Response) => Promise<void>): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await onError?.(res);
    return res.ok;
  } catch {
    return false;
  }
}

export default function ContentList({ initialItems, toggleBranchId }: Props) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // A fresh server render (e.g. after an upload) replaces the local copy.
  useEffect(() => setItems(initialItems), [initialItems]);

  const polling = inFlight(items);
  useEffect(() => {
    if (!polling) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/content', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok && live) setItems((await res.json()) as ContentItemRow[]);
      } catch {
        // Keep the current list; the next tick retries.
      }
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [polling]);

  async function refresh() {
    const res = await fetch('/api/content', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) setItems((await res.json()) as ContentItemRow[]);
  }

  let serverMessage = '';

  async function act(id: string, fn: () => Promise<boolean>, failure: string) {
    setBusyId(id);
    setError('');
    serverMessage = '';
    const ok = await fn();
    if (ok) await refresh().catch(() => undefined);
    else {
      setError(serverMessage || failure);
      if (serverMessage) await refresh().catch(() => undefined); // the item's state may have moved on
    }
    setBusyId(null);
  }

  const retry = (id: string) =>
    act(
      id,
      () =>
        post(`/api/content/${id}/retry`, {}, async (res) => {
          serverMessage = retryErrorMessage(await res.json().catch(() => null));
        }),
      RETRY_FAILED,
    );
  const toggle = (item: ContentItemRow, excluded: boolean) =>
    act(
      item.id,
      () => post('/api/content/exclusions', { branchId: toggleBranchId, contentItemId: item.id, excluded }),
      'Could not update visibility. Please try again.',
    );
  const remove = (item: ContentItemRow) => {
    if (!window.confirm(`Delete "${item.title}"?`)) return Promise.resolve();
    return act(
      item.id,
      async () => {
        try {
          return (await fetch(`/api/content/${item.id}`, { method: 'DELETE', credentials: 'same-origin' })).ok;
        } catch {
          return false;
        }
      },
      'Could not delete. Please try again.',
    );
  };

  if (items.length === 0) return <p className={styles.hint}>Nothing uploaded yet.</p>;

  return (
    <>
      <div role="alert">{error && <p className={styles.error}>{error}</p>}</div>
      <ul className={styles.list}>
        {items.map((item) => {
          const hidden = toggleBranchId !== null && item.excludedBranchIds.includes(toggleBranchId);
          const busy = busyId === item.id;
          return (
            <li key={item.id} className={styles.item}>
              <h3 className={styles.itemTitle}>{item.title}</h3>
              <p className={styles.meta}>
                {item.kind === 'book' ? 'Book' : 'Material'} · {item.subjectName} · Grade {item.grade} ·{' '}
                {SCOPE[item.scope]}
              </p>
              <span className={`${styles.badge} ${styles[item.status]}`}>{LABEL[item.status]}</span>
              {item.status === 'failed' && item.ingestError && <p className={styles.error}>{item.ingestError}</p>}
              {item.ocrSkippedPages > 0 && (
                <p className={styles.meta}>OCR skipped on {item.ocrSkippedPages} pages</p>
              )}
              <div className={styles.actions}>
                {(item.status === 'failed' || isStuckCandidate(item)) && (
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => retry(item.id)}>
                    Retry
                  </button>
                )}
                {toggleBranchId && item.scope === 'school' && (
                  <button type="button" className={styles.secondary} disabled={busy}
                    onClick={() => toggle(item, !hidden)}>
                    {hidden ? 'Show for this branch' : 'Hide for this branch'}
                  </button>
                )}
                <button type="button" className={styles.danger} disabled={busy} onClick={() => remove(item)}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
