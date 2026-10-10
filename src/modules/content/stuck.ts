/** A queued/processing item this old with no live job lost its job (e.g. a queue was recreated); retry may re-enqueue it. */
export const STUCK_INGEST_AFTER_MS = 15 * 60_000;
