import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge, Card, DataTable, EmptyState, Field, PageShell, Stat } from '@/app/ui/components';

describe('components', () => {
  it('DataTable renders the empty state with no rows and the rows otherwise', () => {
    const cols = [{ header: 'Name', cell: (r: { n: string }) => r.n }];
    expect(renderToStaticMarkup(<DataTable columns={cols} rows={[]} empty="No students yet" />)).toContain('No students yet');
    const html = renderToStaticMarkup(<DataTable columns={cols} rows={[{ n: 'Riya' }]} empty="x" />);
    expect(html).toContain('Riya');
    expect(html).toContain('Name');
  });

  it('renders the simple components', () => {
    const html = renderToStaticMarkup(
      <PageShell title="Dash" nav={<a href="/x">Nav</a>}>
        <Card title="C"><Stat label="Students" value={3} /><Badge tone="warn">weak</Badge></Card>
        <Field label="Amount"><input /></Field>
        <EmptyState>nothing</EmptyState>
      </PageShell>,
    );
    for (const s of ['Dash', 'Nav', 'Students', 'weak', 'Amount', 'nothing']) expect(html).toContain(s);
  });
});
