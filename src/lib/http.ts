import type { z } from 'zod';
import { DomainError, type ErrorCode } from '@/lib/errors';
import { resolveActor, SESSION_TTL_MS, type Actor } from '@/modules/tenancy';

export const SESSION_COOKIE = 'sid';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  INVALID_USERNAME: 400,
  WEAK_PASSWORD: 400,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ACCOUNT_REMOVED: 403,
  INVALID_CODE: 404,
  NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  STUDENT_REMOVED: 409,
  CODE_DISABLED: 410,
  INVITE_INVALID: 410,
};

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
        return errorResponse(STATUS[err.code] ?? 400, err.code, err.message, err.details);
      }
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      // Log the error only; never the request (bodies may hold passwords).
      console.error('Unhandled error in route handler', err);
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

/** Parses the JSON body with `schema`; malformed JSON or schema failures become 400 VALIDATION. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
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
