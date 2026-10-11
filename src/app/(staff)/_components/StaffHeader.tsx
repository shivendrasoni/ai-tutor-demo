import Link from 'next/link';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import LogoutButton from '@/app/ui/LogoutButton';
import type { StaffLink } from '../_lib/links';

export default function StaffHeader({ links }: { links: StaffLink[] }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Brand />
        <nav aria-label="Account" className="flex flex-1 flex-wrap items-center gap-1">
          {links.map((l) => (
            <Link key={l.label} href={l.href} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground hover:no-underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  );
}
