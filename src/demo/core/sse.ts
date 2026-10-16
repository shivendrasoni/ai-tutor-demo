/** Builds a streamed text/event-stream Response from scripted events, spaced by `gapMs`. */
export function sseResponse(events: { event: string; data: unknown }[], gapMs = 35, signal?: AbortSignal | null): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const e of events) {
        if (signal?.aborted) break;
        controller.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
        await new Promise((r) => setTimeout(r, gapMs));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

/** Splits text into word-sized chunks for a token-by-token feel. */
export const chunkWords = (text: string): string[] => text.match(/\S+\s*/g) ?? [];
