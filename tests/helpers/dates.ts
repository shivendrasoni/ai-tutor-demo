/**
 * Relative payment dates, so fixtures never age out of recordPayment's "paidAt not older than a year" bound.
 * UTC midnight of yesterday: always in the past, always inside the bounds, stable within a test run.
 */
export const recentPaidAt = (daysAgo = 1, now: Date = new Date()): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
