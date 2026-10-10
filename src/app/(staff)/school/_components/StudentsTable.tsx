import { Badge, DataTable } from '@/app/ui/components';
import { formatDate } from '@/app/ui/format';
import type { StudentRow } from '@/modules/enrollment';
import RemoveButton from './RemoveButton';

const TONE = { active: 'ok', pending_payment: 'warn', lapsed: 'bad', removed: 'muted' } as const;
const LABEL = { active: 'active', pending_payment: 'pending payment', lapsed: 'lapsed', removed: 'removed' } as const;

export default function StudentsTable({ rows, canRemove }: { rows: StudentRow[]; canRemove: boolean }) {
  const columns = [
    { header: 'Name', cell: (r: StudentRow) => r.name },
    { header: 'Username', cell: (r: StudentRow) => r.username ?? '—' },
    { header: 'Grade / section', cell: (r: StudentRow) => `${r.grade}${r.sectionName ? ` / ${r.sectionName}` : ''}` },
    { header: 'Status', cell: (r: StudentRow) => <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge> },
    { header: 'Plan', cell: (r: StudentRow) => r.planName ?? '—' },
    { header: 'Period end', cell: (r: StudentRow) => formatDate(r.periodEnd) },
    ...(canRemove
      ? [{
          header: 'Actions',
          cell: (r: StudentRow) => (r.status === 'removed' ? '—' : <RemoveButton studentId={r.userId} name={r.name} />),
        }]
      : []),
  ];
  return <DataTable columns={columns} rows={rows} empty="No students yet" />;
}
