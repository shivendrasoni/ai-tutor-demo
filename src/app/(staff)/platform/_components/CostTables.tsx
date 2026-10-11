import type * as React from 'react';
import { Card } from '@/app/ui/components';
import { EmptyState } from '@/app/ui/components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CostSummary } from '@/modules/analytics';

const usd = (n: number) => `$${n.toFixed(4)}`;

type Col<T> = { header: string; cell: (r: T) => React.ReactNode; numeric?: boolean };

function CostTable<T>({ columns, rows, empty }: { columns: Col<T>[]; rows: T[]; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map((c) => <TableHead key={c.header} scope="col" className={c.numeric ? 'text-right' : undefined}>{c.header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {columns.map((c) => <TableCell key={c.header} className={c.numeric ? 'text-right tabular-nums' : undefined}>{c.cell(r)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CostTables({ data }: { data: CostSummary }) {
  return (
    <>
      <Card title="By school">
        <CostTable
          rows={data.bySchool}
          empty="No schools yet"
          columns={[
            { header: 'School', cell: (r) => r.name },
            { header: 'Cost', cell: (r) => usd(r.cost), numeric: true },
            { header: 'Tokens', cell: (r) => r.tokens, numeric: true },
            { header: 'Students', cell: (r) => r.students, numeric: true },
          ]}
        />
      </Card>
      <Card title="By skill">
        <CostTable
          rows={data.bySkill}
          empty="No usage in this window"
          columns={[
            { header: 'Skill', cell: (r) => r.skillKey },
            { header: 'Cost', cell: (r) => usd(r.cost), numeric: true },
            { header: 'Tokens', cell: (r) => r.tokens, numeric: true },
            { header: 'Turns', cell: (r) => r.turns, numeric: true },
          ]}
        />
      </Card>
    </>
  );
}
