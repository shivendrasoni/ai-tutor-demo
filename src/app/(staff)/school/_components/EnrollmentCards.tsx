import { Card, Stat } from '@/app/ui/components';
import type { Totals } from '../loaders';

export default function EnrollmentCards({ totals }: { totals: Totals }) {
  return (
    <Card title="Enrollment">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending payment" value={totals.pending} />
        <Stat label="Active" value={totals.active} />
        <Stat label="Lapsed" value={totals.lapsed} />
        <Stat label="Removed" value={totals.removed} />
      </div>
    </Card>
  );
}
