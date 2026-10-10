export type PlanInterval = 'monthly' | 'annual';

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Adds one calendar month (monthly) or twelve (annual) in UTC, clamping to the last day of the target month. */
export function addInterval(start: Date, interval: PlanInterval): Date {
  const months = interval === 'annual' ? 12 : 1;
  const total = start.getUTCFullYear() * 12 + start.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(start.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()),
  );
}
