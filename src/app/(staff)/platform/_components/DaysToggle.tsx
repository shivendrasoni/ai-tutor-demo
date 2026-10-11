import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function DaysToggle({ base, days }: { base: string; days: 7 | 30 }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">Window:</span>
      <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {([7, 30] as const).map((d) =>
          d === days ? (
            <strong key={d} aria-current="true" className="rounded-md bg-background px-3 py-1 font-semibold shadow-sm">Last {d} days</strong>
          ) : (
            <Link key={d} href={`${base}?days=${d}`} className={cn('rounded-md px-3 py-1 text-muted-foreground hover:text-foreground')}>Last {d} days</Link>
          ),
        )}
      </div>
    </div>
  );
}
