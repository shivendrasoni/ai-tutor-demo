const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string; anything else can never name a row. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
