import styles from '../../staff.module.css';
import { requirePageActor } from '@/lib/guard';
import PaymentsTable from '../_components/PaymentsTable';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadPayments } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payments · AI Tutor for Schools' };

export default async function PaymentsPage() {
  const actor = await requirePageActor(['platform']);
  let rows: Awaited<ReturnType<typeof loadPayments>>;
  try {
    rows = await loadPayments(actor);
  } catch (e) {
    return pageError('Payments', e);
  }
  return (
    <>
      <h1 className={styles.title}>Payments</h1>
      <PlatformNav />
      <PaymentsTable rows={rows} />
    </>
  );
}
