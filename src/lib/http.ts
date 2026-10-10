import type { z } from 'zod';
import { DomainError, type ErrorCode } from '@/lib/errors';
import { redactError } from '@/lib/redact';

export { redactError };
import { resolveActor, SESSION_TTL_MS, type Actor } from '@/modules/tenancy';

export const SESSION_COOKIE = 'sid';

export const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  INVALID_USERNAME: 400,
  WEAK_PASSWORD: 400,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ACCOUNT_REMOVED: 403,
  INVALID_CODE: 404,
  NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  ATTEMPT_EXPIRED: 409,
  STUDENT_REMOVED: 409,
  CODE_DISABLED: 410,
  INVITE_INVALID: 410,
  BUDGET_EXCEEDED: 429,
  GENERATION_LIMIT: 429,
  TUTOR_BUSY: 503,
};

/** HTTP status for a domain error code (400 for unknown codes). */
export const statusFor = (code: string): number => (STATUS as Record<string, number>)[code] ?? 400;

/** HTTP-only error (not a domain outcome), e.g. a missing/expired session. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function errorResponse(status: number, code: string, message?: string, details?: Record<string, unknown>): Response {
  const error: Record<string, unknown> = { code };
  if (message !== undefined) error.message = message;
  if (details !== undefined) error.details = details;
  return json({ error }, { status });
}

/** Wraps a route handler: maps DomainError/HttpError to JSON error responses and anything else to 500 INTERNAL. */
export function handle<A extends unknown[]>(
  fn: (req: Request, ...rest: A) => Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await fn(req, ...rest);
    } catch (err) {
      if (err instanceof DomainError) {
        return errorResponse(statusFor(err.code), err.code, err.message, err.details);
      }
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      // Log a redacted summary only; never the request or the raw error (query params may hold secrets).
      console.error('Unhandled error in route handler', redactError(err));
      return errorResponse(500, 'INTERNAL');
    }
  };
}

const validation = (message: string, error?: z.ZodError) =>
  new DomainError(
    'VALIDATION',
    message,
    error ? { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } : undefined,
  );

export const MAX_BODY_BYTES = 100 * 1024;

/** True when the Content-Type media type is exactly application/json (parameters such as charset allowed). */
function isJsonContentType(header: string | null): boolean {
  return header?.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * Parses the JSON body with `schema`. Requires `Content-Type: application/json` (so cross-site "simple"
 * form/fetch posts, which cannot set it without a CORS preflight, are refused) and caps the body at
 * MAX_BODY_BYTES. Wrong content type, oversized or malformed bodies, and schema failures are 400 VALIDATION.
 */
export async function readJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<z.output<S>> {
  if (!isJsonContentType(req.headers.get('content-type'))) {
    throw validation('Content-Type must be application/json');
  }
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw validation('Request body is too large');
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw validation('Request body could not be read');
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw validation('Request body is too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw validation('Request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validation('Invalid request body', parsed.error);
  return parsed.data;
}

/** Parses an object (query params, route params) with `schema`; failures become 400 VALIDATION. */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown, message = 'Invalid request'): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validation(message, parsed.error);
  return parsed.data;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const value = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sessionToken(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

/** Resolves the session cookie to an Actor or throws 401 UNAUTHENTICATED. */
export async function requireActor(req: Request): Promise<Actor> {
  const actor = await resolveActor(sessionToken(req));
  if (!actor) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
  return actor;
}

const secureAttr = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');

export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureAttr()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureAttr()}`;
}
