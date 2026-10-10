export type RedactedError = { name: string; message: string; code?: string; cause?: RedactedError };

const MAX_MESSAGE = 200;

function safeMessage(raw: string): string {
  let m = raw.split('\n')[0];
  // Driver/ORM messages embed the SQL and its parameters; keep only the fact that a query failed.
  if (/^Failed query/i.test(m)) return 'Failed query';
  m = m.replace(/\s*\bparams?:.*$/i, '').replace(/\$argon2[^\s,]*/g, '[redacted]');
  return m.slice(0, MAX_MESSAGE);
}

/**
 * A log-safe summary of an unknown error: name, first message line (SQL, params and password hashes
 * stripped), driver code, and the same for `cause`. Never includes `params`, stack frames or query text.
 */
export function redactError(err: unknown, depth = 0): RedactedError {
  if (!(err instanceof Error)) return { name: 'NonError', message: typeof err === 'string' ? safeMessage(err) : typeof err };
  const out: RedactedError = { name: err.name, message: safeMessage(err.message) };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = String(code);
  if (err.cause !== undefined && depth < 3) out.cause = redactError(err.cause, depth + 1);
  return out;
}
