/** Inclusive index range of selectable layers for a drawing. */
export interface LayerRange {
  min: number
  max: number
}

export const DEFAULT_LAYER_RANGE: LayerRange = { min: 1, max: 6 }

/** Hard bounds to keep ranges sane. */
export const LAYER_RANGE_LIMIT = { min: -50, max: 50 }

/** All integer ids in [min, max], ascending. */
export function layerRangeIds(range: LayerRange): number[] {
  const ids: number[] = []
  for (let id = range.min; id <= range.max; id++) ids.push(id)
  return ids
}

/** Valid iff both ends are integers within limits and min <= max. */
export function isValidLayerRange(range: LayerRange): boolean {
  const { min, max } = range
  if (!Number.isInteger(min) || !Number.isInteger(max)) return false
  if (min > max) return false
  if (min < LAYER_RANGE_LIMIT.min || max > LAYER_RANGE_LIMIT.max) return false
  return true
}

/** Widen `range` so it includes every id in `contentIds`. */
export function clampRangeToContent(
  range: LayerRange,
  contentIds: number[],
): LayerRange {
  if (contentIds.length === 0) return range
  return {
    min: Math.min(range.min, ...contentIds),
    max: Math.max(range.max, ...contentIds),
  }
}
