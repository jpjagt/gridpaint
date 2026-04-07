import type { Layer } from "@/stores/drawingStores"
import type { SelectionBounds } from "@/hooks/useSelection"

/**
 * Computes the center of gravity (average position) of all points
 * on visible layers that fall within the given selection bounds.
 * Returns null if no points are found.
 */
export function computeCenterOfGravity(
  layers: Layer[],
  bounds: SelectionBounds | null
): { x: number; y: number } | null {
  if (!bounds) return null

  let totalX = 0
  let totalY = 0
  let count = 0

  for (const layer of layers) {
    if (!layer.isVisible) continue

    for (const group of layer.groups) {
      for (const pointKey of group.points) {
        const [x, y] = pointKey.split(",").map(Number)
        
        // Check if point is within bounds
        if (
          x >= bounds.minX &&
          x <= bounds.maxX &&
          y >= bounds.minY &&
          y <= bounds.maxY
        ) {
          totalX += x
          totalY += y
          count++
        }
      }
    }
  }

  if (count === 0) return null

  return {
    x: totalX / count,
    y: totalY / count,
  }
}
