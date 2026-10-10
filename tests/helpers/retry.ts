const RETRYABLE = new Set(['40P01', '55P03']); // deadlock_detected, lock_not_available

/** Retries `fn` when Postgres reports a deadlock or lock timeout; any other error is rethrown at once. */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; backoffMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const backoffMs = opts.backoffMs ?? 100;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      const code = e?.code ?? e?.cause?.code;
      if (!code || !RETRYABLE.has(code) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
}
