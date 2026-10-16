import Link from 'next/link';
import { Card, DataTable } from '@/app/ui/components';
import type { FlaggedRow } from '@/demo/areas/platform/types';

export default function FlagsTable({ rows }: { rows: FlaggedRow[] }) {
  return (
    <Card>
      <DataTable
        rows={rows}
        empty="No flagged conversations"
        columns={[
          { header: 'Date', cell: (r) => r.createdAt.slice(0, 10) },
          { header: 'School', cell: (r) => r.schoolName },
          { header: 'Student', cell: (r) => r.studentName },
          { header: 'Reason', cell: (r) => r.reason ?? '—' },
          { header: 'Excerpt', cell: (r) => r.excerpt },
          { header: 'Review', cell: (r) => <Link href={`/platform/flags/${r.messageId}`} className="text-primary hover:underline">Open</Link> },
        ]}
      />
    </Card>
  );
}
