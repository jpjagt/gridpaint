/** Per-layer uniform scale, stored as a rational with one side always 1. */
export interface LayerScale {
  num: number
  den: number
}

/**
 * Convert a layer scale to a numeric multiplier. Absent ⇒ 1.
 * `{num:2,den:1}` → 2 (bigger), `{num:1,den:2}` → 0.5 (smaller).
 */
export function scaleToFactor(scale: LayerScale | undefined): number {
  if (!scale) return 1
  return scale.num / scale.den
}
