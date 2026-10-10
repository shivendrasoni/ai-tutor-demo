/** Browser-side Server-Sent Events helpers for the tutor chat stream. */

export type SseEvent = { event: string; data: unknown };

/** Splits a buffer into complete SSE events plus the unfinished remainder. Frames with unparsable data are skipped. */
export function parseSseChunks(buf: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const text = buf.replace(/\r\n/g, '\n');
  let start = 0;
  for (let end = text.indexOf('\n\n', start); end !== -1; end = text.indexOf('\n\n', start)) {
    const frame = text.slice(start, end);
    start = end + 2;
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      // malformed frame: ignore
    }
  }
  return { events, rest: text.slice(start) };
}

export type Citation = {
  n: number;
  chunkId: string;
  itemTitle: string;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
};

export type StreamHandlers = {
  onMeta?: (d: { messageId: string; skill: string; modelTier: string; notice?: string }) => void;
  onDelta?: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onDone?: (d: { tokensIn: number; tokensOut: number }) => void;
  /** `status` is the HTTP status for pre-stream failures (401, 403, 429, ...), 200 for in-stream error events, 0 for network errors. */
  onError?: (e: { code: string; message: string; status: number }) => void;
  signal?: AbortSignal;
};

/** POSTs a student message and dispatches the SSE events to the handlers. Never throws. */
export async function streamMessage(conversationId: string, text: string, h: StreamHandlers): Promise<void> {
  const fail = (code: string, message: string, status: number) => h.onError?.({ code, message, status });
  let res: Response;
  try {
    res = await fetch(`/api/tutor/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: h.signal,
    });
  } catch {
    if (!h.signal?.aborted) fail('NETWORK', "We couldn't reach the server. Check your connection and try again.", 0);
    return;
  }
  if (!res.ok || !res.body) {
    let err: { code?: string; message?: string } | undefined;
    try {
      err = ((await res.json()) as { error?: { code?: string; message?: string } }).error;
    } catch {
      // non-JSON body
    }
    fail(err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong. Please try again.', res.status);
    return;
  }
  const dispatch = (e: SseEvent) => {
    const d = e.data as never;
    if (e.event === 'meta') h.onMeta?.(d);
    else if (e.event === 'delta') h.onDelta?.((d as { text: string }).text);
    else if (e.event === 'citations') h.onCitations?.((d as { citations: Citation[] }).citations);
    else if (e.event === 'done') h.onDone?.(d);
    else if (e.event === 'error') fail((d as { code: string }).code, (d as { message: string }).message, 200);
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parsed = parseSseChunks(buf);
      buf = parsed.rest;
      parsed.events.forEach(dispatch);
    }
  } catch {
    if (!h.signal?.aborted) fail('NETWORK', "We couldn't reach the server. Check your connection and try again.", 0);
  }
}

/** `Book · Chapter · p. 12–13`; a single page is `p. 12`. */
export function formatCitation(c: Pick<Citation, 'itemTitle' | 'chapterTitle' | 'pageStart' | 'pageEnd'>): string {
  const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `p. ${c.pageStart}–${c.pageEnd}`;
  return `${c.itemTitle} · ${c.chapterTitle} · ${pages}`;
}
