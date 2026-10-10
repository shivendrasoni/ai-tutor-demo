import styles from '../../staff.module.css';
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
    <>
      <h1 className={styles.title}>Flagged conversations</h1>
      <PlatformNav />
      <p>
        {current === 'open' ? <strong>Open</strong> : <Link href="/platform/flags?status=open">Open</Link>}{' '}
        {current === 'reviewed' ? <strong>Reviewed</strong> : <Link href="/platform/flags?status=reviewed">Reviewed</Link>}
      </p>
      <FlagsTable rows={rows} />
    </>
  );
}
