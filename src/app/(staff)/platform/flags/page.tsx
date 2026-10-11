import { requirePageActor } from '@/lib/guard';
import Link from 'next/link';
import FlagsTable from '../_components/FlagsTable';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadFlags } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Flags · AI Tutor for Schools' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FlagsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requirePageActor(['platform']);
  const status = one((await searchParams).status);
  let rows: Awaited<ReturnType<typeof loadFlags>>;
  try {
    rows = await loadFlags(actor, { status });
  } catch (e) {
    return pageError('Flags', e);
  }
  const current = status === 'reviewed' ? 'reviewed' : 'open';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Flagged conversations</h1>
      <PlatformNav />
      <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {(['open', 'reviewed'] as const).map((s) => {
          const label = s === 'open' ? 'Open' : 'Reviewed';
          return s === current ? (
            <strong key={s} aria-current="true" className="rounded-md bg-background px-3 py-1 text-sm font-semibold shadow-sm">{label}</strong>
          ) : (
            <Link key={s} href={`/platform/flags?status=${s}`} className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">{label}</Link>
          );
        })}
      </div>
      <FlagsTable rows={rows} />
    </div>
  );
}
