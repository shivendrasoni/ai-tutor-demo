'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DaysToggle from '../_components/DaysToggle';
import RoutingCards from '../_components/RoutingCards';
import RoutingConfigForm from '../_components/RoutingConfigForm';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { usePlatform } from '../_components/usePlatform';
import { parseDays, selectRouting } from '@/demo/areas/platform/selectors';

function Routing() {
  const s = usePlatform();
  const raw = useSearchParams().get('days');
  let days: 7 | 30;
  try {
    days = parseDays(raw);
  } catch (e) {
    return pageError('Routing', e);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Routing</h1>
      <PlatformNav />
      <DaysToggle base="/platform/routing" days={days} />
      <RoutingCards stats={selectRouting(s, days)} />
      <RoutingConfigForm config={s.routingConfig} />
    </div>
  );
}

export default function RoutingPage() {
  return <Suspense fallback={null}><Routing /></Suspense>;
}
