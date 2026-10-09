import { describe, expect, it } from 'vitest';
import { addInterval } from '@/modules/enrollment/periods';

describe('addInterval', () => {
  it('monthly clamps to the last day of the target month', () => {
    expect(addInterval(new Date('2027-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });
  it('monthly handles leap years', () => {
    expect(addInterval(new Date('2028-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('annual keeps the same instant next year', () => {
    expect(addInterval(new Date('2027-03-15T10:00:00Z'), 'annual').toISOString()).toBe('2028-03-15T10:00:00.000Z');
  });
  it('monthly rolls over the year and keeps time of day', () => {
    expect(addInterval(new Date('2027-12-15T08:30:00Z'), 'monthly').toISOString()).toBe('2028-01-15T08:30:00.000Z');
  });
  it('annual from Feb 29 clamps to Feb 28', () => {
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'annual').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});
