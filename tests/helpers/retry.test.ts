import { describe, expect, it, vi } from 'vitest';
import { withDeadlockRetry } from './retry';

const pgErr = (code: string) => Object.assign(new Error('pg ' + code), { code });

describe('withDeadlockRetry', () => {
  it('retries on 40P01 and then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(pgErr('40P01')).mockRejectedValueOnce(pgErr('55P03')).mockResolvedValue('ok');
    await expect(withDeadlockRetry(fn, { backoffMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('rethrows other errors immediately', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('23505'));
    await expect(withDeadlockRetry(fn, { backoffMs: 1 })).rejects.toMatchObject({ code: '23505' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('gives up after 5 attempts', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('40P01'));
    await expect(withDeadlockRetry(fn, { backoffMs: 1 })).rejects.toMatchObject({ code: '40P01' });
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
