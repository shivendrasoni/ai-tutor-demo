import { requirePageActor } from '@/lib/guard';
import CostTables from '../_components/CostTables';
import DaysToggle from '../_components/DaysToggle';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadCosts } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Costs · AI Tutor for Schools' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requirePageActor(['platform']);
  const days = one((await searchParams).days);
  let data: Awaited<ReturnType<typeof loadCosts>>;
  try {
    data = await loadCosts(actor, { days });
  } catch (e) {
    return pageError('Costs', e);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Costs</h1>
      <PlatformNav />
      <DaysToggle base="/platform/costs" days={days === '30' ? 30 : 7} />
      <CostTables data={data} />
    </div>
  );
}
