'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { personaById } from '@/demo/core/personas';
import { usePersona } from '@/demo/core/store';

/** Demo: the root sends you to the active persona's home. */
export default function Home() {
  const router = useRouter();
  const persona = usePersona();
  useEffect(() => {
    router.replace(personaById(persona).home);
  }, [persona, router]);
  return null;
}
