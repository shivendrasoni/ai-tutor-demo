'use client';
import { Card, Stat } from '@/app/ui/components';
import { formatMoney } from '@/app/ui/format';
import { selectOverview } from '@/demo/areas/platform/selectors';
import PlatformNav from './_components/PlatformNav';
import { usePlatform } from './_components/usePlatform';

export default function PlatformPage() {
  const o = selectOverview(usePlatform());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform</h1>
      <PlatformNav />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Pending payments" value={o.pendingPayments} />
          <Stat label="Open flags" value={o.openFlags} />
          <Stat label="Cost, last 30 days" value={formatMoney(Math.round(o.cost30d * 100), 'USD')} />
        </div>
      </Card>
    </div>
  );
}
