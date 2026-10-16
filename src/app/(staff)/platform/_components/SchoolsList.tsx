import { Badge, Card, EmptyState } from '@/app/ui/components';
import type { SchoolListing } from '@/demo/areas/platform/types';

export default function SchoolsList({ schools }: { schools: SchoolListing[] }) {
  if (schools.length === 0) return <Card title="Schools"><EmptyState>No schools yet</EmptyState></Card>;
  return (
    <>
      {schools.map((s) => (
        <Card key={s.id} title={`${s.name} (${s.board})`}>
          {s.branches.length === 0 ? (
            <EmptyState>No branches yet</EmptyState>
          ) : (
            <ul className="divide-y rounded-xl border">
              {s.branches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{b.name}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{b.signupCode}</code>
                  <Badge tone={b.signupCodeEnabled ? 'ok' : 'muted'}>{b.signupCodeEnabled ? 'enabled' : 'disabled'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </>
  );
}
