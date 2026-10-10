import { Card, DataTable } from '@/app/ui/components';
import type { CostSummary } from '@/modules/analytics';

const usd = (n: number) => `$${n.toFixed(4)}`;

export default function CostTables({ data }: { data: CostSummary }) {
  return (
    <>
      <Card title="By school">
        <DataTable
          rows={data.bySchool}
          empty="No schools yet"
          columns={[
            { header: 'School', cell: (r) => r.name },
            { header: 'Cost', cell: (r) => usd(r.cost) },
            { header: 'Tokens', cell: (r) => r.tokens },
            { header: 'Students', cell: (r) => r.students },
          ]}
        />
      </Card>
      <Card title="By skill">
        <DataTable
          rows={data.bySkill}
          empty="No usage in this window"
          columns={[
            { header: 'Skill', cell: (r) => r.skillKey },
            { header: 'Cost', cell: (r) => usd(r.cost) },
            { header: 'Tokens', cell: (r) => r.tokens },
            { header: 'Turns', cell: (r) => r.turns },
          ]}
        />
      </Card>
    </>
  );
}
