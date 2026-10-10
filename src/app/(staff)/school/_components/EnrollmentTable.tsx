import { Card, DataTable } from '@/app/ui/components';
import type { EnrollmentRow } from '@/modules/analytics';

export default function EnrollmentTable({ rows }: { rows: EnrollmentRow[] }) {
  return (
    <Card title="Branch by grade">
      <DataTable
        rows={rows}
        empty="No enrollment yet"
        columns={[
          { header: 'Branch', cell: (r) => r.branchName },
          { header: 'Grade', cell: (r) => r.grade },
          { header: 'Pending', cell: (r) => r.pending },
          { header: 'Active', cell: (r) => r.active },
          { header: 'Lapsed', cell: (r) => r.lapsed },
          { header: 'Removed', cell: (r) => r.removed },
        ]}
      />
    </Card>
  );
}
