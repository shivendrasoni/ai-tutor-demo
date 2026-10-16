'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { installDemoFetch } from './fetch';
import { allowedPersonas, personaById } from './personas';
import PersonaSwitcher from './PersonaSwitcher';
import { registerAll, seeds } from '../registry';
import { hydrateStore, initStore, usePersona, useSlice } from './store';
import { CORE_KEY, type CoreSeed } from './seed-core';

// Must run before any child effect issues a fetch, so it happens at module load on the client.
initStore(seeds); // also on the server, so SSR renders the seed state
if (typeof window !== 'undefined') {
  registerAll();
  installDemoFetch();
}

/** Root of the demo: hydrates the store, guards routes by persona and shows the persona switcher. */
export default function DemoShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() ?? '/';
  const persona = usePersona();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateStore();
    setReady(true);
  }, []);

  const core = useSlice<CoreSeed>(CORE_KEY);
  const me = core.users.find((u) => u.id === personaById(persona).userId);
  // A student who was awaiting payment may enter /learn once their account is active.
  const activated = persona === 'student_pending' && me?.status === 'active';
  const allowed = allowedPersonas(path);
  const blocked =
    ready && allowed !== null && !allowed.includes(persona) && !(activated && (path === '/learn' || path.startsWith('/learn/')));
  useEffect(() => {
    if (blocked) router.replace(personaById(persona).home);
  }, [blocked, persona, router]);

  return (
    <>
      {ready && !blocked ? children : null}
      {ready ? <PersonaSwitcher /> : null}
    </>
  );
}
