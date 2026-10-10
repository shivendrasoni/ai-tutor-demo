'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AUTOSAVE_MS, shouldAutosave } from './timing';

/**
 * Calls `save` every 10 s while dirty (checked on a 1 s tick), and exposes `flush` for navigation and submit.
 * `markDirty` is called by the form on every change.
 */
export function useAutosave(save: () => Promise<boolean>, enabled = true): { markDirty: () => void; flush: () => Promise<boolean> } {
  const dirty = useRef(false);
  const last = useRef(Date.now());
  const saving = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    if (!dirty.current) return true;
    dirty.current = false;
    const p = saveRef.current();
    saving.current = p;
    const ok = await p;
    saving.current = null;
    last.current = Date.now();
    if (!ok) dirty.current = true;
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (shouldAutosave(last.current, dirty.current, Date.now())) void flush();
    }, Math.min(1000, AUTOSAVE_MS));
    return () => clearInterval(t);
  }, [enabled, flush]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  return { markDirty, flush };
}
