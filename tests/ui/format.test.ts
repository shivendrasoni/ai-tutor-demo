import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, pct, toMinor } from '@/app/ui/format';

describe('format', () => {
  it('toMinor parses exactly', () => {
    expect(toMinor('499')).toBe(49900);
    expect(toMinor('499.9')).toBe(49990);
    expect(toMinor('499.90')).toBe(49990);
    expect(toMinor('0.07')).toBe(7);
    expect(toMinor('1.15')).toBe(115);
    expect(toMinor(' 12.50 ')).toBe(1250);
    expect(toMinor('21474836.47')).toBe(2147483647);
  });

  it('toMinor rejects invalid input', () => {
    const bad = ['', '  ', '-1', '-0.5', '+1', '1.005', 'abc', '1e3', '1.', '.5', '1,000', '21474836.48', '99999999999'];
    for (const b of bad) expect(() => toMinor(b), b).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('formats money, pct and dates', () => {
    expect(formatMoney(49900, 'INR')).toContain('499');
    expect(pct(null)).toBe('—');
    expect(pct(0.734)).toBe('73%');
    expect(formatDate(null)).toBe('—');
    expect(formatDate(new Date('2027-03-01T23:59:59Z'))).toBe('2027-03-01');
  });
});
