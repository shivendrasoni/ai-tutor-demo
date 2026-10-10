import styles from '../../staff.module.css';
import { requirePageActor } from '@/lib/guard';
import DaysToggle from '../_components/DaysToggle';
import RoutingCards from '../_components/RoutingCards';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadRouting } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Routing · AI Tutor for Schools' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RoutingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requirePageActor(['platform']);
  const days = one((await searchParams).days);
  let stats: Awaited<ReturnType<typeof loadRouting>>;
  try {
    stats = await loadRouting(actor, { days });
  } catch (e) {
    return pageError('Routing', e);
  }
  return (
    <>
      <h1 className={styles.title}>Routing</h1>
      <PlatformNav />
      <DaysToggle base="/platform/routing" days={days === '30' ? 30 : 7} />
      <RoutingCards stats={stats} />
    </>
  );
}
