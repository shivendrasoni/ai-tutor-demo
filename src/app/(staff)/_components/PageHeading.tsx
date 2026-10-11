import type { ReactNode } from 'react';

export default function PageHeading({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {lead ? <p className="text-muted-foreground">{lead}</p> : null}
      </div>
      {actions}
    </div>
  );
}
