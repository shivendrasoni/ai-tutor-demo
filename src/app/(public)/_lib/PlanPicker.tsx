'use client';

import { formatMoney } from '@/app/ui/format';

export type PlanOption = { id: string; name: string; interval: 'monthly' | 'annual'; priceMinor: number; currency: string };

export const SUCCESS_COPY = "Account created. You'll be able to log in once your payment is confirmed.";

export default function PlanPicker({ plans, value, onChange }: { plans: PlanOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-medium leading-none">Plan</legend>
      {plans.length === 0 ? <p className="text-sm text-muted-foreground">No plans are available right now.</p> : null}
      {plans.map((p) => (
        <label
          key={p.id}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
        >
          <input type="radio" name="plan" value={p.id} checked={value === p.id} onChange={() => onChange(p.id)} required className="size-4 shrink-0 accent-primary" />
          <span>{p.name} ({formatMoney(p.priceMinor, p.currency)} per {p.interval === 'annual' ? 'year' : 'month'})</span>
        </label>
      ))}
    </fieldset>
  );
}
