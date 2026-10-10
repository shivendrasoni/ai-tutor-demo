import { DomainError } from '@/lib/errors';
import { json, statusFor } from '@/lib/http';
import type { TurnEvent } from '@/modules/tutor';

const encoder = new TextEncoder();
const frame = (e: TurnEvent) => encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

/**
 * Turns tutor events into a Server-Sent Events response. The first event is pulled before the Response exists,
 * so pre-stream failures surface as normal JSON errors: a thrown DomainError is rethrown (for `handle`), and a
 * first-event `error` becomes `{error:{code,message}}` with the mapped status. Cancelling the stream calls the
 * iterator's `return()`, which lets the turn persist its partial result.
 */
export async function toSse(events: AsyncIterable<TurnEvent>, signal?: AbortSignal): Promise<Response> {
  const it = events[Symbol.asyncIterator]();
  let first: IteratorResult<TurnEvent>;
  try {
    first = await it.next();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    await it.return?.().catch(() => undefined);
    throw err;
  }
  if (!first.done && first.value.type === 'error') {
    await it.return?.().catch(() => undefined);
    const { code, message } = first.value.data;
    return json({ error: { code, message } }, { status: statusFor(code) });
  }
  let pending: IteratorResult<TurnEvent> | null = first;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = pending ?? (await it.next());
        pending = null;
        if (r.done) return controller.close();
        controller.enqueue(frame(r.value));
      } catch {
        // Mid-stream failure: the status line is already sent, so report it as an SSE error event.
        controller.enqueue(
          frame({ type: 'error', data: { code: 'TUTOR_BUSY', message: 'The tutor is busy right now. Please try again in a moment.' } }),
        );
        controller.close();
      }
    },
    async cancel() {
      await it.return?.().catch(() => undefined);
    },
  });
  void signal; // the request signal is handed to runTurn, which owns abort handling
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
