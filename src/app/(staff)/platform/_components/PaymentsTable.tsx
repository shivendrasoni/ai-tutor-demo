import { Badge, Card, DataTable } from '@/app/ui/components';
import { formatMoney } from '@/app/ui/format';
import type { PendingRow } from '@/modules/enrollment';
import RecordPaymentForm from './RecordPaymentForm';

export default function PaymentsTable({ rows }: { rows: PendingRow[] }) {
  return (
    <Card title="Pending and lapsed">
      <DataTable
        rows={rows}
        empty="No pending payments"
        columns={[
          { header: 'Student', cell: (r) => <>{r.studentName}{r.username ? <> ({r.username})</> : null}</> },
          { header: 'School', cell: (r) => <>{r.schoolName} / {r.branchName}</> },
          { header: 'Grade', cell: (r) => r.grade },
          { header: 'Parent', cell: (r) => <>{r.parentName} {r.parentPhone}</> },
          { header: 'Plan', cell: (r) => <>{r.planName} {formatMoney(r.priceMinor, r.currency)}</> },
          { header: 'Status', cell: (r) => <Badge tone={r.status === 'lapsed' ? 'bad' : 'warn'}>{r.status}</Badge> },
          { header: 'Record payment', cell: (r) => <RecordPaymentForm row={r} /> },
        ]}
      />
    </Card>
  );
}
