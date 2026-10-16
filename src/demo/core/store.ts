'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_PERSONA, type PersonaId } from './personas';

/** Seed of each area slice, registered by `registry.ts`. */
export type SliceSeeds = Record<string, unknown>;

type State = { persona: PersonaId; slices: Record<string, unknown> };

const STORAGE_KEY = 'ai-tutor-demo:v1';
let seeds: SliceSeeds = {};
let state: State = { persona: DEFAULT_PERSONA, slices: {} };
let hydrated = false;
const listeners = new Set<() => void>();

const clone = <T,>(v: T): T => structuredClone(v);

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the demo keeps working in memory */
  }
}

/** Called once by DemoShell with every area's seed. */
export function initStore(s: SliceSeeds) {
  seeds = s;
  state = { persona: DEFAULT_PERSONA, slices: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, clone(v)])) };
}

/** Loads persisted state (client only). Slices missing from storage fall back to their seed. */
export function hydrateStore() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as State;
      state = { persona: saved.persona, slices: { ...state.slices, ...saved.slices } };
    }
  } catch {
    /* ignore corrupt storage */
  }
  emit();
}

export function resetStore() {
  state = { persona: state.persona, slices: Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, clone(v)])) };
  persist();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getPersona = () => state.persona;

export function setPersona(p: PersonaId) {
  state = { ...state, persona: p };
  persist();
  emit();
}

export function usePersona(): PersonaId {
  return useSyncExternalStore(subscribe, () => state.persona, () => DEFAULT_PERSONA);
}

/** Current value of one area slice. */
export function getSlice<T>(key: string): T {
  return state.slices[key] as T;
}

/** Applies an immutable-style update: `fn` receives a draft clone and may mutate it or return a replacement. */
export function mutateSlice<T>(key: string, fn: (draft: T) => T | void): void {
  const draft = clone(state.slices[key] as T);
  const next = fn(draft) ?? draft;
  state = { ...state, slices: { ...state.slices, [key]: next } };
  persist();
  emit();
}

/** Subscribe a component to a slice (re-renders on any change to that slice). */
export function useSlice<T>(key: string): T {
  return useSyncExternalStore(
    subscribe,
    () => state.slices[key] as T,
    () => state.slices[key] as T,
  );
}
