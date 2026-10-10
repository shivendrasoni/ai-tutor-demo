import { describe, expect, it } from 'vitest';
import { createSaveQueue } from '@/app/(student)/learn/study/_lib/saveQueue';

const deferred = () => {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSaveQueue', () => {
  it('does nothing when clean and reports success', async () => {
    let calls = 0;
    const q = createSaveQueue(async () => (calls++, true));
    expect(await q.flush()).toBe(true);
    expect(calls).toBe(0);
  });

  it('serializes overlapping flushes: the second waits for the first and finds nothing left to save', async () => {
    const d = deferred();
    let calls = 0;
    const q = createSaveQueue(() => (calls++, d.promise));
    q.markDirty();
    const f1 = q.flush();
    const f2 = q.flush();
    await tick();
    expect(calls).toBe(1);
    d.resolve(true);
    expect(await f1).toBe(true);
    expect(await f2).toBe(true);
    expect(calls).toBe(1);
  });

  it('an edit during an in-flight save triggers a second save that sees the newest data', async () => {
    const gates = [deferred(), deferred()];
    let latest = 'v1';
    const sent: string[] = [];
    const q = createSaveQueue(() => {
      sent.push(latest);
      return gates[sent.length - 1]!.promise;
    });
    q.markDirty();
    const f1 = q.flush();
    await tick();
    latest = 'v2';
    q.markDirty();
    const f2 = q.flush();
    gates[0]!.resolve(true);
    await f1;
    await tick();
    gates[1]!.resolve(true);
    expect(await f2).toBe(true);
    expect(sent).toEqual(['v1', 'v2']);
  });

  it('a failed save re-marks dirty and flush returns false; a later flush retries', async () => {
    const results = [false, true];
    let calls = 0;
    const q = createSaveQueue(async () => results[calls++]!);
    q.markDirty();
    expect(await q.flush()).toBe(false);
    expect(q.isDirty()).toBe(true);
    expect(await q.flush()).toBe(true);
    expect(q.isDirty()).toBe(false);
    expect(calls).toBe(2);
  });

  it('a throwing save counts as a failure', async () => {
    const q = createSaveQueue(async () => {
      throw new Error('boom');
    });
    q.markDirty();
    expect(await q.flush()).toBe(false);
    expect(q.isDirty()).toBe(true);
  });
});
