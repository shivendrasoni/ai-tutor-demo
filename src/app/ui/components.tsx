import type { ReactNode } from 'react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Card as UiCard, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function PageShell({ title, nav, children }: { title: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {nav ? <nav className="flex flex-wrap gap-2">{nav}</nav> : null}
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <UiCard className="min-w-0">
      {title ? (
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn(!title && 'pt-6')}>{children}</CardContent>
    </UiCard>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/60 px-4 py-3">
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

const tones = {
  ok: 'border-transparent bg-success/15 text-success',
  warn: 'border-transparent bg-warning/20 text-amber-700 dark:text-warning',
  bad: 'border-transparent bg-destructive/15 text-destructive',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  return <UiBadge variant="outline" className={cn('whitespace-nowrap', tones[tone])}>{children}</UiBadge>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  rowKey,
}: {
  columns: { header: string; cell: (row: T) => ReactNode }[];
  rows: T[];
  empty: string;
  /** Stable per-row key; defaults to the row index. */
  rowKey?: (row: T) => string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map((c, ci) => (
              <TableHead key={ci} scope="col">{c.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={rowKey ? rowKey(r) : i}>
              {columns.map((c, ci) => (
                <TableCell key={ci}>{c.cell(r)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="mb-4 flex flex-col items-stretch gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </Label>
  );
}
