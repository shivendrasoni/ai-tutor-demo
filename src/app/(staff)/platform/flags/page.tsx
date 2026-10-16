'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FlagsTable from '../_components/FlagsTable';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { usePlatform } from '../_components/usePlatform';
import { parseFlagStatus, selectFlags } from '@/demo/areas/platform/selectors';

function Flags() {
  const s = usePlatform();
  const status = useSearchParams().get('status');
  let current: 'open' | 'reviewed';
  try {
    current = parseFlagStatus(status);
  } catch (e) {
    return pageError('Flags', e);
  }
  const rows = selectFlags(s, current);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Flagged conversations</h1>
      <PlatformNav />
      <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {(['open', 'reviewed'] as const).map((st) => {
          const label = st === 'open' ? 'Open' : 'Reviewed';
          return st === current ? (
            <strong key={st} aria-current="true" className="rounded-md bg-background px-3 py-1 text-sm font-semibold shadow-sm">{label}</strong>
          ) : (
            <Link key={st} href={`/platform/flags?status=${st}`} className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">{label}</Link>
          );
        })}
      </div>
      <FlagsTable rows={rows} />
    </div>
  );
}

export default function FlagsPage() {
  return <Suspense fallback={null}><Flags /></Suspense>;
}
