'use client';
import PaymentsTable from '../_components/PaymentsTable';
import PlatformNav from '../_components/PlatformNav';
import RecentPayments from '../_components/RecentPayments';
import { usePlatform } from '../_components/usePlatform';
import { selectPending } from '@/demo/areas/platform/selectors';

export default function PaymentsPage() {
  const s = usePlatform();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>
      <PlatformNav />
      <PaymentsTable rows={selectPending(s)} />
      <RecentPayments rows={s.payments} />
    </div>
  );
}
