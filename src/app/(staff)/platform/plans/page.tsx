'use client';
import CreatePlanForm from '../_components/CreatePlanForm';
import PlansList from '../_components/PlansList';
import PlatformNav from '../_components/PlatformNav';
import { usePlatform } from '../_components/usePlatform';

export default function PlansPage() {
  const s = usePlatform();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Plans</h1>
      <PlatformNav />
      <PlansList plans={s.plans} />
      <CreatePlanForm />
    </div>
  );
}
