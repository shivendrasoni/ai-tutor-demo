import { describe, expect, it } from 'vitest';
import { codeCopy, submitError } from '@/app/(public)/_lib/submit-error';

describe('submitError', () => {
  it('uses the same friendly copy for INVALID_CODE / CODE_DISABLED as the code lookup', () => {
    for (const code of ['INVALID_CODE', 'CODE_DISABLED']) {
      const r = submitError({ code, message: 'raw server text' } as never);
      expect(r.message).toBe(codeCopy(code));
      expect(r.message).not.toContain('raw server text');
    }
    expect(codeCopy('INVALID_CODE')).toMatch(/isn't valid/);
    expect(codeCopy('CODE_DISABLED')).toMatch(/turned off/);
    expect(codeCopy('OTHER')).toBeUndefined();
  });
});
