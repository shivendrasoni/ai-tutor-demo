import { describe, expect, it } from 'vitest';
import { formatCitation } from '@/app/(student)/learn/study/_lib/format';
import { formatClock, nextPollDelay, secondsLeft, shouldAutosave, takeLinkLabel } from '@/app/(student)/learn/study/_lib/timing';

describe('study helpers', () => {
  it('secondsLeft never goes negative', () =>
    expect(secondsLeft('2027-01-01T00:00:00Z', Date.parse('2027-01-01T00:00:05Z'))).toBe(0));
  it('secondsLeft counts down to the deadline', () =>
    expect(secondsLeft('2027-01-01T00:00:10Z', Date.parse('2027-01-01T00:00:05Z'))).toBe(5));
  it('autosave fires only when dirty and 10s elapsed', () => {
    expect(shouldAutosave(0, true, 9_999)).toBe(false);
    expect(shouldAutosave(0, true, 10_000)).toBe(true);
    expect(shouldAutosave(0, false, 60_000)).toBe(false);
  });
  it('polls every 2s only while generating', () => {
    expect(nextPollDelay('generating')).toBe(2000);
    expect(nextPollDelay('ready')).toBeNull();
  });
  it('formats citations', () =>
    expect(formatCitation({ itemTitle: 'Maths 8', chapterTitle: 'Real Numbers', pageStart: 12, pageEnd: 13, chunkId: 'x' })).toBe('Maths 8 · Real Numbers · p. 12–13'));
  it('formats a single page and the clock', () => {
    expect(formatCitation({ itemTitle: 'B', chapterTitle: 'C', pageStart: 4, pageEnd: 4, chunkId: 'x' })).toBe('B · C · p. 4');
    expect(formatClock(7200)).toBe('2:00:00');
    expect(formatClock(65)).toBe('0:01:05');
  });
  it('labels the take link: Resume while the attempt can still be resumed, else Start a new attempt', () => {
    const now = Date.parse('2027-01-01T01:00:00Z');
    expect(takeLinkLabel('in_progress', null, now)).toBe('Resume attempt');
    expect(takeLinkLabel('in_progress', '2027-01-01T01:30:00Z', now)).toBe('Resume attempt');
    expect(takeLinkLabel('in_progress', '2027-01-01T00:58:30Z', now)).toBe('Resume attempt'); // inside the 2 min grace
    expect(takeLinkLabel('in_progress', '2027-01-01T00:57:00Z', now)).toBe('Start a new attempt');
    expect(takeLinkLabel('graded', null, now)).toBe('Start a new attempt');
  });
});
