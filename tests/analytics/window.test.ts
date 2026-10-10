import { describe, expect, it } from 'vitest';
import { windowStart, windowStartDate } from '@/modules/analytics/window';

describe('windowStart', () => {
  it('7-day window starts at UTC midnight 6 days back, including today', () => {
    expect(windowStart(new Date('2027-03-10T15:00:00Z'), 7).toISOString()).toBe('2027-03-04T00:00:00.000Z');
    expect(windowStart(new Date('2027-03-10T00:00:00.000Z'), 30).toISOString()).toBe('2027-02-09T00:00:00.000Z');
  });
  it('IST evening that is already next UTC day uses the UTC date', () =>
    expect(windowStart(new Date('2027-03-09T18:30:00Z'), 7).toISOString()).toBe('2027-03-03T00:00:00.000Z'));
  it('crosses month and year boundaries', () => {
    expect(windowStart(new Date('2027-01-03T10:00:00Z'), 7).toISOString()).toBe('2026-12-28T00:00:00.000Z');
  });
  it('windowStartDate is the YYYY-MM-DD string', () => {
    expect(windowStartDate(new Date('2027-03-10T15:00:00Z'), 7)).toBe('2027-03-04');
    expect(windowStartDate(new Date('2027-03-09T18:30:00Z'), 30)).toBe('2027-02-08');
  });
});
