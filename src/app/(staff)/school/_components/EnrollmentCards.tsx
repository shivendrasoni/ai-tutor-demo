import { Card, Stat } from '@/app/ui/components';
import styles from '@/app/ui/ui.module.css';
import type { Totals } from '../loaders';

export default function EnrollmentCards({ totals }: { totals: Totals }) {
  return (
    <Card title="Enrollment">
      <div className={styles.grid}>
        <Stat label="Pending payment" value={totals.pending} />
        <Stat label="Active" value={totals.active} />
        <Stat label="Lapsed" value={totals.lapsed} />
        <Stat label="Removed" value={totals.removed} />
      </div>
    </Card>
  );
}
