import { Card, DataTable } from '@/app/ui/components';
import { formatMoney } from '@/app/ui/format';
import type { RecordedPayment } from '@/demo/areas/platform/types';

export default function RecentPayments({ rows }: { rows: RecordedPayment[] }) {
  return (
    <Card title="Recently recorded">
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No payments recorded yet"
        columns={[
          { header: 'Student', cell: (r) => r.studentName },
          { header: 'School', cell: (r) => r.schoolName },
          { header: 'Plan', cell: (r) => r.planName },
          { header: 'Amount', cell: (r) => formatMoney(r.amountMinor, r.currency) },
          { header: 'Reference', cell: (r) => r.externalRef ?? '—' },
          { header: 'Paid', cell: (r) => r.paidAt.slice(0, 10) },
          { header: 'Covered until', cell: (r) => r.periodEnd.slice(0, 10) },
        ]}
      />
    </Card>
  );
}
