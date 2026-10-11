import type { ReactNode } from 'react';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';

export const metadata = { title: 'AI Tutor for Schools' };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-gradient-to-b from-accent/70 via-background to-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}
