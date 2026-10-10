'use client';

import { formatMoney } from '@/app/ui/format';
import styles from '../public.module.css';

export type PlanOption = { id: string; name: string; interval: 'monthly' | 'annual'; priceMinor: number; currency: string };

export const SUCCESS_COPY = "Account created. You'll be able to log in once your payment is confirmed.";

export default function PlanPicker({ plans, value, onChange }: { plans: PlanOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className={styles.plans}>
      <legend>Plan</legend>
      {plans.length === 0 ? <p className={styles.hint}>No plans are available right now.</p> : null}
      {plans.map((p) => (
        <label key={p.id} className={styles.radio}>
          <input type="radio" name="plan" value={p.id} checked={value === p.id} onChange={() => onChange(p.id)} required />
          <span>{p.name} ({formatMoney(p.priceMinor, p.currency)} per {p.interval === 'annual' ? 'year' : 'month'})</span>
        </label>
      ))}
    </fieldset>
  );
}
