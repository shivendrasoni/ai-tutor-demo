import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { redactError, readJson, statusFor } from '@/lib/http';

const S = z.object({ a: z.string() });
const streamReq = (stream: ReadableStream<Uint8Array>) =>
  new Request('http://x', { method: 'POST', body: stream, headers: { 'content-type': 'application/json' }, duplex: 'half' } as RequestInit);

describe('readJson streaming cap', () => {
  it('cancels a chunked body without content-length once it passes the cap', async () => {
    let pulled = 0;
    let cancelled = false;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(enc.encode('x'.repeat(40)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const err = await readJson(streamReq(stream), S, 100).catch((e) => e);
    expect(err.code).toBe('VALIDATION');
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });

  it('a stream error is 400 VALIDATION, not a 500', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error('socket hang up'));
      },
    });
    const err = await readJson(streamReq(stream), S).catch((e) => e);
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('Request body could not be read');
  });
});

describe('misc', () => {
  it('does not log arbitrary non-Error values', () => {
    expect(redactError('secret-token')).toEqual({ name: 'string' });
    expect(redactError({ password: 'x' })).toEqual({ name: 'object' });
  });
  it('unknown code maps to 400', () => expect(statusFor('NOPE')).toBe(400));
});
