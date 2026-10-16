'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { installDemoFetch } from './fetch';
import { allowedPersonas, personaById } from './personas';
import PersonaSwitcher from './PersonaSwitcher';
import { registerAll, seeds } from '../registry';
import { hydrateStore, initStore, usePersona } from './store';

// Must run before any child effect issues a fetch, so it happens at module load on the client.
if (typeof window !== 'undefined') {
  initStore(seeds);
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

  const allowed = allowedPersonas(path);
  const blocked = ready && allowed !== null && !allowed.includes(persona);
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
