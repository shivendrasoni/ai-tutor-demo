import { Card, Stat } from '@/app/ui/components';
import { formatMoney } from '@/app/ui/format';
import { requirePageActor } from '@/lib/guard';
import PlatformNav from './_components/PlatformNav';
import { pageError } from './_components/PageError';
import { loadOverview } from './loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform · AI Tutor for Schools' };

export default async function PlatformPage() {
  const actor = await requirePageActor(['platform']);
  let o: Awaited<ReturnType<typeof loadOverview>>;
  try {
    o = await loadOverview(actor);
  } catch (e) {
    return pageError('Platform', e);
  }
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
