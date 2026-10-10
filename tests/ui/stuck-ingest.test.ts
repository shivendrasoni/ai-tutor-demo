import { describe, expect, it } from 'vitest';
import { isStuckCandidate, retryErrorMessage } from '@/app/(staff)/_components/ContentList';

describe('isStuckCandidate', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const at = (min: number) => new Date(now - min * 60_000);
  it('offers Retry only for queued/processing items older than 15 minutes', () => {
    expect(isStuckCandidate({ status: 'queued', updatedAt: at(16) }, now)).toBe(true);
    expect(isStuckCandidate({ status: 'processing', updatedAt: at(16) }, now)).toBe(true);
    expect(isStuckCandidate({ status: 'queued', updatedAt: at(14) }, now)).toBe(false);
    expect(isStuckCandidate({ status: 'ready', updatedAt: at(99) }, now)).toBe(false);
    expect(isStuckCandidate({ status: 'failed', updatedAt: at(99) }, now)).toBe(false);
  });

  it('measures from the last activity (updatedAt), so a re-queued old item does not show Retry', () => {
    // Uploaded long ago (createdAt would say stuck) but re-queued 1 minute ago.
    const requeued = { status: 'queued' as const, createdAt: at(999), updatedAt: at(1) };
    expect(isStuckCandidate(requeued, now)).toBe(false);
    expect(isStuckCandidate({ ...requeued, updatedAt: at(16) }, now)).toBe(true);
  });
});

describe('retryErrorMessage', () => {
  it("shows the server's message cleanly, else a generic one", () => {
    expect(retryErrorMessage({ error: { code: 'VALIDATION', message: 'Only failed or stuck items can be retried' } })).toBe(
      'Only failed or stuck items can be retried',
    );
    expect(retryErrorMessage(null)).toBe('Could not retry. Please try again.');
    expect(retryErrorMessage({ error: { code: 'INTERNAL' } })).toBe('Could not retry. Please try again.');
  });
});
