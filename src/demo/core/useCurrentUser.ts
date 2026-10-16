'use client';
import { useSlice, usePersona } from './store';
import { personaById } from './personas';
import { CORE_KEY, type CoreSeed, type CoreUser } from './seed-core';

/** The demo user behind the active persona (null for the platform admin) plus the shared core data. */
export function useCurrentUser(): { persona: ReturnType<typeof personaById>; user: CoreUser | null; core: CoreSeed } {
  const id = usePersona();
  const core = useSlice<CoreSeed>(CORE_KEY);
  const persona = personaById(id);
  return { persona, user: core.users.find((u) => u.id === persona.userId) ?? null, core };
}
