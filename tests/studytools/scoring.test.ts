import { describe, expect, it } from 'vitest';
import { clampScore } from '@/modules/studytools/scoring';

describe('clampScore', () => {
  it.each([[7.3, 5, 5], [-1, 5, 0], [2.2, 5, 2], [2.25, 5, 2.5], [2.74, 5, 2.5], [0.2, 1, 0], [Number.NaN, 5, 0], [3, 5, 3]])(
    'clampScore(%s, %s) = %s', (s, m, e) => expect(clampScore(s, m)).toBe(e),
  );
});
