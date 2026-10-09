type PgLikeError = { code?: unknown; constraint?: unknown };

/** Drizzle wraps driver errors (DrizzleQueryError) with the pg error on `.cause`; accept either shape. */
function pgError(err: unknown): PgLikeError | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as PgLikeError & { cause?: unknown };
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  if (e.cause && typeof e.cause === 'object') return e.cause as PgLikeError;
  return undefined;
}

/** True for a Postgres unique violation (23505), optionally on a specific constraint or unique index. */
export function isUniqueViolation(err: unknown, constraintOrIndex?: string): boolean {
  const pg = pgError(err);
  if (pg?.code !== '23505') return false;
  return constraintOrIndex === undefined || pg.constraint === constraintOrIndex;
}
