import type { ReactElement } from 'react';
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

  it('DataTable keys rows by rowKey (index fallback) and header cells by index', () => {
    type R = { id: string };
    const cols = [
      { header: 'Name', cell: (r: R) => r.id },
      { header: 'Name', cell: (r: R) => r.id },
    ];
    const keysOf = (el: ReactElement<any>, tag: string): (string | null)[] => {
      const out: (string | null)[] = [];
      const walk = (n: any) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n.type === tag) out.push(n.key);
        walk(n.props?.children);
      };
      walk(el);
      return out;
    };
    const rows = [{ id: 'a' }, { id: 'b' }];
    const byKey = DataTable({ columns: cols, rows, rowKey: (r: R) => r.id, empty: 'x' }) as ReactElement<any>;
    expect(keysOf(byKey, 'tr')).toEqual([null, 'a', 'b']); // thead tr has no key
    expect(keysOf(byKey, 'th')).toEqual(['0', '1']);
    const byIdx = DataTable({ columns: cols, rows, empty: 'x' }) as ReactElement<any>;
    expect(keysOf(byIdx, 'tr').slice(1)).toEqual(['0', '1']);
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
