'use client';
import type { ReactNode } from 'react';
import { useCurrentUser } from '@/demo/core/useCurrentUser';
import StaffHeader from './_components/StaffHeader';

export default function StaffLayout({ children }: { children: ReactNode }) {
  const { persona } = useCurrentUser();
  return (
    <div className="min-h-svh bg-background">
      <StaffHeader links={[{ href: persona.home, label: 'Home' }]} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
