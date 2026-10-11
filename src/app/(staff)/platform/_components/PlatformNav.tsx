'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  ['/platform', 'Overview'], ['/platform/payments', 'Payments'], ['/platform/schools', 'Schools'], ['/platform/plans', 'Plans'],
  ['/platform/flags', 'Flags'], ['/platform/costs', 'Costs'], ['/platform/routing', 'Routing'], ['/school/content', 'Content'],
] as const;

export default function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {LINKS.map(([href, label]) => {
        const active = href === '/platform' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
