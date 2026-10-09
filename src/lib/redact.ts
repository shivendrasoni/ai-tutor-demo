/** Redaction for logging unexpected errors (route handlers, CLI): never prints SQL params or raw messages. */

const MAX_LOG_MESSAGE = 200;

/** Drops anything from a "params:" marker on, then truncates. */
function safeMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  const cut = message.split(/params:/i)[0].trimEnd();
  return cut.length > MAX_LOG_MESSAGE ? `${cut.slice(0, MAX_LOG_MESSAGE)}…` : cut;
}

/** Stack frames only: the stack's header repeats the (unredacted) message, so it is dropped. */
function safeStack(err: Error): string | undefined {
  return err.stack
    ?.split('\n')
    .filter((l) => /^\s+at /.test(l))
    .join('\n');
}

/**
 * Builds a loggable summary of an unexpected error: name, a truncated message without params, and stack frames.
 * Drizzle "Failed query" errors embed SQL + bound params in the message, so for those only the
 * driver cause's code/message are kept.
 */
export function redactError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { name: typeof err };
  const cause = (err as { cause?: unknown }).cause as { code?: unknown; message?: unknown } | undefined;
  if (err.message.startsWith('Failed query')) {
    return {
      name: err.name,
      message: 'Failed query',
      cause: cause && typeof cause === 'object'
        ? { code: typeof cause.code === 'string' ? cause.code : undefined, message: safeMessage(cause.message) }
        : undefined,
      stack: safeStack(err),
    };
  }
  return { name: err.name, message: safeMessage(err.message), stack: safeStack(err) };
}
