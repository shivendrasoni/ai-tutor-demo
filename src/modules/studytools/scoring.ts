/** Clamps a score to 0..marks and rounds to the nearest 0.5. Non-finite input scores 0. */
export function clampScore(score: number, marks: number): number {
  if (!Number.isFinite(score)) return 0;
  const rounded = Math.round(score * 2) / 2;
  return Math.min(Math.max(rounded, 0), marks);
}
