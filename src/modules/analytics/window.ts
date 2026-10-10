const DAY_MS = 86_400_000;

/** UTC midnight of `now - (days - 1)` days: the last `days` UTC calendar days including today. */
export function windowStart(now: Date, days: 7 | 30): Date {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayUtc - (days - 1) * DAY_MS);
}

/** `YYYY-MM-DD` of `windowStart`, for comparing with `usage_daily.date`. */
export function windowStartDate(now: Date, days: 7 | 30): string {
  return windowStart(now, days).toISOString().slice(0, 10);
}
