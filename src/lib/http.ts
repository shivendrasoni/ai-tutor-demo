import type { z } from 'zod';
import { DomainError, type ErrorCode } from '@/lib/errors';
import { redactError } from '@/lib/redact';
import { resolveActor, SESSION_TTL_MS, type Actor } from '@/modules/tenancy';

export { redactError };

export const SESSION_COOKIE = 'sid';
export const MAX_BODY_BYTES = 100 * 1024;

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
  STUDENT_REMOVED: 409,
  ATTEMPT_EXPIRED: 409,
  CODE_DISABLED: 410,
  INVITE_INVALID: 410,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 429,
  GENERATION_LIMIT: 429,
  TUTOR_BUSY: 503,
};

export const statusFor = (code: string): number => STATUS[code as ErrorCode] ?? 500;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Wraps a route handler: maps DomainError/HttpError to JSON errors; anything else is a logged (redacted) 500. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handle<C = any>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx?: C): Promise<Response> => {
    try {
      return await fn(req, ctx as C);
    } catch (err) {
      if (err instanceof DomainError) {
        const headers = new Headers();
        if (err.code === 'RATE_LIMITED') {
          const ms = Number(err.details?.retryAfterMs);
          if (Number.isFinite(ms) && ms > 0) headers.set('retry-after', String(Math.ceil(ms / 1000)));
        }
        return json(
          { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
          { status: statusFor(err.code), headers },
        );
      }
      if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      console.error('Unhandled API error', redactError(err));
      return json({ error: { code: 'INTERNAL' } }, { status: 500 });
    }
  };
}

export function parseWith<S extends z.ZodTypeAny>(schema: S, value: unknown, message = 'Invalid request'): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new DomainError('VALIDATION', message, {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

/** Reads and validates an application/json body, capped at `maxBytes` (default 100 KB). */
export async function readJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<z.infer<S>> {
  const type = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new DomainError('VALIDATION', 'Content-Type must be application/json');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new DomainError('VALIDATION', 'Request body too large');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new DomainError('VALIDATION', 'Request body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new DomainError('VALIDATION', 'Invalid JSON body');
  }
  return parseWith(schema, body);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return undefined;
}

export const sessionToken = (req: Request): string | undefined => readCookie(req, SESSION_COOKIE);

export async function requireActor(req: Request): Promise<Actor> {
  const actor = await resolveActor(sessionToken(req));
  if (!actor) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
  return actor;
}

function cookieAttrs(maxAgeSeconds: number): string {
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000))}`;

export const clearSessionCookie = (): string => `${SESSION_COOKIE}=; ${cookieAttrs(0)}`;
