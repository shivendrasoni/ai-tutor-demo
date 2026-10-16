import { Card, DataTable } from '@/app/ui/components';
import { formatMoney } from '@/app/ui/format';
import type { PlanOption as Plan } from '@/demo/areas/platform/types';

export default function PlansList({ plans }: { plans: Plan[] }) {
  return (
    <Card title="Active plans">
      <DataTable
        rows={plans}
        empty="No plans yet"
        columns={[
          { header: 'Name', cell: (p) => p.name },
          { header: 'Interval', cell: (p) => p.interval },
          { header: 'Price', cell: (p) => formatMoney(p.priceMinor, p.currency) },
        ]}
      />
    </Card>
  );
}
