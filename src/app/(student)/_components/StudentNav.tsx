'use client';

import { BookOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import LogoutButton from '@/app/ui/LogoutButton';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/learn', label: 'Learn', Icon: Sparkles, match: (p: string) => p === '/learn' || p.startsWith('/learn/c/') },
  { href: '/learn/study', label: 'Study', Icon: BookOpen, match: (p: string) => p.startsWith('/learn/study') },
];

/** One <nav>: a bottom tab bar on phones, centred pills in the top bar from `sm` up. */
export default function StudentNav() {
  const path = usePathname() ?? '';
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Brand href="/learn" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
      <nav
        aria-label="Student"
        className={cn(
          'fixed inset-x-3 bottom-3 z-40 flex gap-2 rounded-3xl border bg-card/95 p-2 shadow-lg backdrop-blur',
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-2 sm:-translate-x-1/2 sm:gap-1 sm:rounded-full sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none',
        )}
      >
        {tabs.map(({ href, label, Icon, match }) => {
          const on = match(path);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-5 py-2 text-xs font-bold no-underline transition-colors hover:no-underline',
                'sm:flex-none sm:flex-row sm:gap-2 sm:rounded-full sm:py-2 sm:text-sm',
                on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="size-6 sm:size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
