import { Card, DataTable } from '@/app/ui/components';
import { formatDate } from '@/app/ui/format';
import type { StudentUsageRow } from '@/modules/analytics';

export default function UsageTable({ rows }: { rows: StudentUsageRow[] }) {
  return (
    <Card title="Tutor usage">
      <DataTable
        rows={rows}
        empty="No usage yet"
        columns={[
          { header: 'Student', cell: (r) => r.name },
          { header: 'Section', cell: (r) => r.sectionName ?? '—' },
          { header: 'Messages (7 days)', cell: (r) => r.messages7d },
          { header: 'Messages (30 days)', cell: (r) => r.messages30d },
          { header: 'Last active', cell: (r) => formatDate(r.lastActiveAt) },
        ]}
      />
    </Card>
  );
}
