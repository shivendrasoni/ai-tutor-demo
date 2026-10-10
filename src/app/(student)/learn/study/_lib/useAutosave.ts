'use client';

import { useEffect, useRef } from 'react';
import { createSaveQueue, type SaveQueue } from './saveQueue';
import { shouldAutosave } from './timing';

/**
 * Autosave: saves every 10 s while dirty (checked on a 1 s tick) and exposes `flush` for navigation and submit.
 * `markDirty` is called by the form on every change. Ordering lives in `createSaveQueue`.
 */
export function useAutosave(save: () => Promise<boolean>, enabled = true): { markDirty: () => void; flush: () => Promise<boolean> } {
  const saveRef = useRef(save);
  saveRef.current = save;
  const queue = useRef<SaveQueue | null>(null);
  if (!queue.current) queue.current = createSaveQueue(() => saveRef.current());
  const q = queue.current;

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (shouldAutosave(q.lastSavedAt(), q.isDirty(), Date.now())) void q.flush();
    }, 1000);
    return () => clearInterval(t);
  }, [enabled, q]);

  return { markDirty: q.markDirty, flush: q.flush };
}
