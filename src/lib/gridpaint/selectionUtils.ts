/**
 * Utilities for working with rectangular selections on the grid.
 */

import type { Layer } from "@/stores/drawingStores"
import type { SelectionBounds } from "@/hooks/useSelection"

/**
 * Return a copy of `layers` with all points and pointModifications clipped
 * to the given selection bounds (inclusive on all sides).
 *
 * Layers that end up with zero points after clipping are omitted from the
 * result so downstream export functions don't produce empty files.
 */
export function clipLayersToSelection(
  layers: Layer[],
  bounds: SelectionBounds,
): Layer[] {
  const { minX, minY, maxX, maxY } = bounds

  const clipped: Layer[] = []

  for (const layer of layers) {
    // Clip each group's points
    const clippedGroups = layer.groups.map((group) => {
      const clippedPoints = new Set<string>()
      for (const key of group.points) {
        const [x, y] = key.split(",").map(Number)
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          clippedPoints.add(key)
        }
      }
      return { ...group, points: clippedPoints }
    })

    // Check if the clipped layer has any points at all
    const totalPoints = clippedGroups.reduce(
      (sum, g) => sum + g.points.size,
      0,
    )
    if (totalPoints === 0) continue

    // Clip pointModifications to the same bounds
    let clippedMods: Layer["pointModifications"] | undefined
    if (layer.pointModifications && layer.pointModifications.size > 0) {
      clippedMods = new Map()
      for (const [key, mod] of layer.pointModifications) {
        const [x, y] = key.split(",").map(Number)
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          clippedMods.set(key, mod)
        }
      }
      if (clippedMods.size === 0) clippedMods = undefined
    }

    clipped.push({
      ...layer,
      groups: clippedGroups,
      pointModifications: clippedMods,
    })
  }

  return clipped
}
