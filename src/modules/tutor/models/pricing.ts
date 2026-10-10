import { modelPrices } from '../config';

/** USD cost for a call, or null when the model has no configured price. `mock/*` models are free. */
export function computeCost(spec: string, tokensIn: number, tokensOut: number): number | null {
  if (spec.startsWith('mock/')) return 0;
  const p = modelPrices()[spec];
  if (!p || !Number.isFinite(p.inPerM) || !Number.isFinite(p.outPerM)) return null;
  return (tokensIn * p.inPerM + tokensOut * p.outPerM) / 1_000_000;
}
