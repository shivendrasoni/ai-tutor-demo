export type PlanInterval = 'monthly' | 'annual';

/** Adds 1 or 12 UTC calendar months, clamping the day to the last day of the target month. */
export function addInterval(start: Date, interval: PlanInterval): Date {
  const months = interval === 'annual' ? 12 : 1;
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}
