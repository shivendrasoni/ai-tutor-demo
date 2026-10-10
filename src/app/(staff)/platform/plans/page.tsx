import styles from '../../staff.module.css';
import { requirePageActor } from '@/lib/guard';
import CreatePlanForm from '../_components/CreatePlanForm';
import PlansList from '../_components/PlansList';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadPlans } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans · AI Tutor for Schools' };

export default async function PlansPage() {
  const actor = await requirePageActor(['platform']);
  let plans: Awaited<ReturnType<typeof loadPlans>>;
  try {
    plans = await loadPlans(actor);
  } catch (e) {
    return pageError('Plans', e);
  }
  return (
    <>
      <h1 className={styles.title}>Plans</h1>
      <PlatformNav />
      <PlansList plans={plans} />
      <CreatePlanForm />
    </>
  );
}
