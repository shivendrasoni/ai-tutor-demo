/**
 * DOM-free save serialization for autosave. `save` must read the newest data when it is called.
 * - flushes run one at a time, in call order;
 * - an edit made while a save is in flight leaves the queue dirty, so the next flush saves again;
 * - a failed (or throwing) save re-marks dirty and the flush resolves false.
 */
export type SaveQueue = {
  markDirty: () => void;
  isDirty: () => boolean;
  /** Epoch ms of the last finished save attempt (initially creation time). */
  lastSavedAt: () => number;
  flush: () => Promise<boolean>;
};

export function createSaveQueue(save: () => Promise<boolean>, nowMs: () => number = Date.now): SaveQueue {
  let dirty = false;
  let last = nowMs();
  let chain: Promise<unknown> = Promise.resolve();

  const flush = (): Promise<boolean> => {
    const run = chain.then(async () => {
      if (!dirty) return true;
      dirty = false;
      let ok = false;
      try {
        ok = await save();
      } catch {
        ok = false;
      }
      last = nowMs();
      if (!ok) dirty = true;
      return ok;
    });
    chain = run;
    return run;
  };

  return { markDirty: () => void (dirty = true), isDirty: () => dirty, lastSavedAt: () => last, flush };
}
