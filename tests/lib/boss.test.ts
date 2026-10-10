import { describe, expect, it, vi } from 'vitest';
import { PgBoss } from 'pg-boss';
import { ensureQueue, getSendBoss, SEND_BOSS_OPTIONS, stopSendBoss } from '@/lib/boss';

describe('shared send-only boss', () => {
  it('returns one instance, built with supervise/schedule off and a pool of 2', async () => {
    const seen: unknown[] = [];
    const fake = { on: vi.fn(), once: vi.fn(), start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const make = (o: unknown) => (seen.push(o), fake as unknown as PgBoss);
    const a = await getSendBoss(make);
    const b = await getSendBoss(make);
    expect(a).toBe(b);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ supervise: false, schedule: false, max: 2 });
    expect(SEND_BOSS_OPTIONS).toEqual({ supervise: false, schedule: false, max: 2 });
    await stopSendBoss();
  });

  it('does not cache a failed start', async () => {
    let n = 0;
    const make = () =>
      ({ on: () => {}, once: () => {}, start: async () => { if (++n === 1) throw new Error('transient'); }, stop: async () => {} }) as unknown as PgBoss;
    await expect(getSendBoss(make)).rejects.toThrow('transient');
    await expect(getSendBoss(make)).resolves.toBeDefined();
    await stopSendBoss();
  });
});

describe('ensureQueue (send-only path)', () => {
  it('never deletes: a policy mismatch only warns and leaves the queue alone', async () => {
    const calls: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boss = {
      getQueue: async () => ({ policy: 'standard' }),
      deleteQueue: async () => void calls.push('delete'),
      createQueue: async () => void calls.push('create'),
    };
    await ensureQueue(boss as never, 'q', { policy: 'stately' });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('policy standard'));
    warn.mockRestore();
  });
  it('creates a missing queue idempotently', async () => {
    const calls: string[] = [];
    const boss = {
      getQueue: async () => null,
      deleteQueue: async () => void calls.push('delete'),
      createQueue: async () => void calls.push('create'),
    };
    await ensureQueue(boss as never, 'q', { policy: 'stately' });
    expect(calls).toEqual(['create']);
  });
  it('leaves a matching queue alone', async () => {
    const calls: string[] = [];
    const boss = {
      getQueue: async () => ({ policy: 'stately' }),
      deleteQueue: async () => void calls.push('delete'),
      createQueue: async () => void calls.push('create'),
    };
    await ensureQueue(boss as never, 'q', { policy: 'stately' });
    expect(calls).toEqual([]);
  });
});
