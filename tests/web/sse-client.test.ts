import { describe, expect, it } from 'vitest';
import { formatCitation, parseSseChunks } from '@/lib/sse-client';

describe('parseSseChunks', () => {
  it('parses complete events and returns the remainder', () => {
    const { events, rest } = parseSseChunks('event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"tokensIn":1');
    expect(events).toEqual([{ event: 'delta', data: { text: 'a' } }]);
    expect(rest).toBe('event: done\ndata: {"tokensIn":1');
  });

  it('handles events split across chunks', () => {
    const a = parseSseChunks('event: delta\ndata: {"te');
    expect(a.events).toEqual([]);
    const b = parseSseChunks(a.rest + 'xt":"hi"}\n\nevent: done\ndata: {"tokensIn":1,"tokensOut":2}\n\n');
    expect(b.events).toEqual([
      { event: 'delta', data: { text: 'hi' } },
      { event: 'done', data: { tokensIn: 1, tokensOut: 2 } },
    ]);
    expect(b.rest).toBe('');
  });

  it('keeps multi-byte text intact and tolerates CRLF', () => {
    const { events } = parseSseChunks('event: delta\r\ndata: {"text":"नमस्ते 😀"}\r\n\r\n');
    expect(events).toEqual([{ event: 'delta', data: { text: 'नमस्ते 😀' } }]);
  });

  it('skips malformed data frames', () => {
    const { events, rest } = parseSseChunks('event: delta\ndata: not-json\n\nevent: done\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'done', data: {} }]);
    expect(rest).toBe('');
  });
});

describe('formatCitation', () => {
  const base = { itemTitle: 'Maths 8', chapterTitle: 'Fractions' };
  it('formats page ranges and single pages', () => {
    expect(formatCitation({ ...base, pageStart: 12, pageEnd: 13 })).toBe('Maths 8 · Fractions · p. 12–13');
    expect(formatCitation({ ...base, pageStart: 12, pageEnd: 12 })).toBe('Maths 8 · Fractions · p. 12');
  });
});
