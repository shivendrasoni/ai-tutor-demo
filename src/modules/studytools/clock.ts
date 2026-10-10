let override: (() => Date) | null = null;

/** The current time; tests may override it with `setNow`. */
export const now = (): Date => (override ? override() : new Date());

/** Overrides the clock (pass `null` to restore the real one). */
export function setNow(fn: (() => Date) | null): void {
  override = fn;
}
