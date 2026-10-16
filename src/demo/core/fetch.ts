import { dispatch } from './router';

let installed = false;

/** Routes same-origin `/api/*` requests to the in-browser handlers; everything else uses the real fetch. */
export function installDemoFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const raw = req ? req.url : String(input);
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const delay = 120 + Math.random() * 180; // feels like a network without being slow
    await new Promise((r) => setTimeout(r, delay));
    return dispatch(method, url, init);
  };
}
