'use client';

import { useEffect, useState } from 'react';
import type { ContentItemRow, IngestStatus } from '@/modules/content';
// Direct import (not the module index) so the client bundle does not pull in server code.
import { STUCK_INGEST_AFTER_MS } from '@/modules/content/stuck';
import { AlertCircle, Eye, EyeOff, FileText, RotateCw, Trash2 } from 'lucide-react';
import { Badge } from '@/app/ui/components';
import { Button } from '@/components/ui/button';

type Props = { initialItems: ContentItemRow[]; toggleBranchId: string | null };

const POLL_MS = 3000;
const LABEL: Record<IngestStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};
const TONE: Record<IngestStatus, 'ok' | 'warn' | 'bad' | 'muted'> = {
  queued: 'muted',
  processing: 'warn',
  ready: 'ok',
  failed: 'bad',
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

  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>;

  return (
    <>
      <div role="alert">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const hidden = toggleBranchId !== null && item.excludedBranchIds.includes(toggleBranchId);
          const busy = busyId === item.id;
          return (
            <li key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <h3 className="break-words font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {item.kind === 'book' ? 'Book' : 'Material'} · {item.subjectName} · Grade {item.grade} ·{' '}
                      {SCOPE[item.scope]}
                    </p>
                  </div>
                </div>
                <Badge tone={TONE[item.status]}>{LABEL[item.status]}</Badge>
              </div>
              {item.status === 'failed' && item.ingestError && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {item.ingestError}
                </p>
              )}
              {item.ocrSkippedPages > 0 && (
                <p className="text-sm text-muted-foreground">OCR skipped on {item.ocrSkippedPages} pages</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(item.status === 'failed' || isStuckCandidate(item)) && (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => retry(item.id)}>
                    <RotateCw className="size-4" />Retry
                  </Button>
                )}
                {toggleBranchId && item.scope === 'school' && (
                  <Button type="button" variant="outline" size="sm" disabled={busy}
                    onClick={() => toggle(item, !hidden)}>
                    {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    {hidden ? 'Show for this branch' : 'Hide for this branch'}
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove(item)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="size-4" />Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
