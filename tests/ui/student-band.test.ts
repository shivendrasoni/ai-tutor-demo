import { describe, expect, it } from 'vitest';
import { bandFor, dayStreak, greeting, resultMessage, firstName } from '@/lib/student-band';

describe('bandFor', () => {
  it('maps grades to age bands', () => {
    expect(bandFor(1)).toBe('junior');
    expect(bandFor(5)).toBe('junior');
    expect(bandFor(6)).toBe('middle');
    expect(bandFor(8)).toBe('middle');
    expect(bandFor(9)).toBe('senior');
    expect(bandFor(12)).toBe('senior');
  });
  it('falls back to middle for unknown grades', () => {
    expect(bandFor(null)).toBe('middle');
    expect(bandFor(0)).toBe('middle');
    expect(bandFor(40)).toBe('middle');
  });
});

describe('copy', () => {
  it('uses the first name only', () => {
    expect(firstName('Aarav Sharma')).toBe('Aarav');
    expect(firstName('  ')).toBe('there');
  });
  it('greets by band and time of day', () => {
    expect(greeting('junior', 'Aarav', 9)).toContain('Aarav');
    expect(greeting('senior', 'Aarav', 20)).toMatch(/evening/i);
    expect(greeting('middle', 'Aarav', 3)).toContain('Aarav');
  });
  it('picks a result message by percentage, never shaming a low score', () => {
    expect(resultMessage('junior', 100)).toMatch(/amazing|perfect|star/i);
    expect(resultMessage('senior', 85)).toBeTruthy();
    const low = resultMessage('middle', 10);
    expect(low).toMatch(/practice|try|learn|next/i);
    expect(low).not.toMatch(/fail|bad|wrong/i);
  });
});

describe('dayStreak', () => {
  const day = 86_400_000;
  const now = new Date('2026-10-14T12:00:00Z').getTime();
  it('counts consecutive active days ending today', () => {
    expect(dayStreak([now, now - day, now - 2 * day], now)).toBe(3);
  });
  it('keeps a streak alive when today has no activity yet but yesterday did', () => {
    expect(dayStreak([now - day, now - 2 * day], now)).toBe(2);
  });
  it('breaks on a gap and handles empty input', () => {
    expect(dayStreak([now, now - 3 * day], now)).toBe(1);
    expect(dayStreak([], now)).toBe(0);
    expect(dayStreak([now - 5 * day], now)).toBe(0);
  });
  it('counts several events on one day once', () => {
    expect(dayStreak([now, now - 1000, now - 2000], now)).toBe(1);
  });
});
