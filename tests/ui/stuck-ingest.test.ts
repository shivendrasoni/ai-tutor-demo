import { describe, expect, it } from 'vitest';
import { isStuckCandidate } from '@/app/(staff)/_components/ContentList';

describe('isStuckCandidate', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const at = (min: number) => new Date(now - min * 60_000);
  it('offers Retry only for queued/processing items older than 15 minutes', () => {
    expect(isStuckCandidate({ status: 'queued', createdAt: at(16) }, now)).toBe(true);
    expect(isStuckCandidate({ status: 'processing', createdAt: at(16) }, now)).toBe(true);
    expect(isStuckCandidate({ status: 'queued', createdAt: at(14) }, now)).toBe(false);
    expect(isStuckCandidate({ status: 'ready', createdAt: at(99) }, now)).toBe(false);
    expect(isStuckCandidate({ status: 'failed', createdAt: at(99) }, now)).toBe(false);
  });
});
