/** In-browser API: `fetch('/api/...')` is answered by handlers registered here instead of the network. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export type ApiRequest = {
  method: string;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, or undefined. */
  body: any;
  /** Raw FormData for multipart uploads. */
  form?: FormData;
  signal?: AbortSignal | null;
};

/** Return plain data (sent as JSON 200), `null` for 204, or a `Response` for full control (e.g. SSE). */
export type Handler = (req: ApiRequest) => unknown | Promise<unknown>;
export type Routes = Record<string, Handler>; // key: "GET /api/school/students/:id"

type Compiled = { method: string; re: RegExp; keys: string[]; handler: Handler };

const table: Compiled[] = [];

export function registerRoutes(routes: Routes) {
  for (const [key, handler] of Object.entries(routes)) {
    const [method, pattern] = key.split(' ') as [string, string];
    const keys: string[] = [];
    const src = pattern
      .split('/')
      .map((seg) => (seg.startsWith(':') ? (keys.push(seg.slice(1)), '([^/]+)') : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    table.push({ method, re: new RegExp(`^${src}/?$`), keys, handler });
  }
}

export function clearRoutes() {
  table.length = 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function dispatch(method: string, url: URL, init?: RequestInit): Promise<Response> {
  for (const r of table) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    let body: unknown;
    let form: FormData | undefined;
    if (init?.body instanceof FormData) form = init.body;
    else if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    try {
      const out = await r.handler({ method, url, params, query: url.searchParams, body, form, signal: init?.signal });
      if (out instanceof Response) return out;
      if (out === null) return new Response(null, { status: 204 });
      return json(out);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
      console.error('[demo] handler failed', method, url.pathname, e);
      return json({ error: { code: 'INTERNAL' } }, 500);
    }
  }
  console.warn('[demo] no handler for', method, url.pathname);
  return json({ error: { code: 'NOT_FOUND', message: `Demo has no handler for ${method} ${url.pathname}` } }, 404);
}
