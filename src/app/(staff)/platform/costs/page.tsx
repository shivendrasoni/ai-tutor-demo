'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CostTables from '../_components/CostTables';
import DaysToggle from '../_components/DaysToggle';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { usePlatform } from '../_components/usePlatform';
import { parseDays, selectCosts } from '@/demo/areas/platform/selectors';

function Costs() {
  const s = usePlatform();
  const raw = useSearchParams().get('days');
  let days: 7 | 30;
  try {
    days = parseDays(raw);
  } catch (e) {
    return pageError('Costs', e);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Costs</h1>
      <PlatformNav />
      <DaysToggle base="/platform/costs" days={days} />
      <CostTables data={selectCosts(s, days)} />
    </div>
  );
}

export default function CostsPage() {
  return <Suspense fallback={null}><Costs /></Suspense>;
}
