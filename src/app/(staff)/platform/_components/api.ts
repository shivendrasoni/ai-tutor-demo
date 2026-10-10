/** POST JSON and return an error message (null on success). Never throws. */
export async function postJson(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error?.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}
