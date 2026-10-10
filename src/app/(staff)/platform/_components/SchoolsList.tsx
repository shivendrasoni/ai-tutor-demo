import { Badge, Card, EmptyState } from '@/app/ui/components';
import type { SchoolListing } from '@/modules/analytics';

export default function SchoolsList({ schools }: { schools: SchoolListing[] }) {
  if (schools.length === 0) return <Card title="Schools"><EmptyState>No schools yet</EmptyState></Card>;
  return (
    <>
      {schools.map((s) => (
        <Card key={s.id} title={`${s.name} (${s.board})`}>
          {s.branches.length === 0 ? (
            <EmptyState>No branches yet</EmptyState>
          ) : (
            <ul>
              {s.branches.map((b) => (
                <li key={b.id}>
                  {b.name} <code>{b.signupCode}</code>{' '}
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
