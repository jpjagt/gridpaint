/**
 * Simple validation for layer geometry.
 * Reports disconnected paths and invalid override combinations.
 */

import type { GridLayer } from "../types"
import { getGridLayerPoints } from "../types"
import type { ValidationIssue, QuadrantOverrides } from "@/types/gridpaint"

/**
 * Validate a layer's configuration for potential issues.
 * Not exhaustive -- mainly catches obvious problems.
 */
export function validateLayer(layer: GridLayer): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const allPoints = getGridLayerPoints(layer)

  if (!layer.pointModifications) return issues

  for (const [pointKey, mods] of layer.pointModifications) {
    // Warn if modifications exist on a point that isn't in any group
    if (!allPoints.has(pointKey) && mods.quadrantOverrides) {
      // Only warn if the override isn't creating new filled quadrants
      const hasFilledOverride = Object.values(mods.quadrantOverrides).some(
        (s) => s !== undefined && s !== "empty",
      )
      if (!hasFilledOverride) {
        issues.push({
          severity: "warning",
          pointKey,
          message: `Point ${pointKey} has overrides but is not in any group`,
        })
      }
    }

    // Warn about cutouts on points that aren't active
    if (mods.cutouts && mods.cutouts.length > 0 && !allPoints.has(pointKey)) {
      issues.push({
        severity: "warning",
        pointKey,
        message: `Point ${pointKey} has cutouts but is not an active point`,
      })
    }

    // Check for override orientations that don't match the natural quadrant
    if (mods.quadrantOverrides) {
      const overrides = mods.quadrantOverrides
      const naturalDirections: Record<number, string> = {
        0: "se",  // SE quadrant naturally curves SE
        1: "sw",  // SW quadrant naturally curves SW
        2: "nw",  // NW quadrant naturally curves NW
        3: "ne",  // NE quadrant naturally curves NE
      }

      for (const qStr of Object.keys(overrides)) {
        const q = parseInt(qStr) as 0 | 1 | 2 | 3
        const state = overrides[q]
        if (!state) continue

        // Check if a curve override faces an unexpected direction
        if (state.startsWith("convex-") || state.startsWith("concave-")) {
          const direction = state.split("-")[1]
          if (direction !== naturalDirections[q]) {
            issues.push({
              severity: "warning",
              pointKey,
              quadrant: q,
              message: `Quadrant ${q} has non-natural curve direction "${state}" (natural: ${naturalDirections[q]}). Path stitching may produce disconnected segments.`,
            })
          }
        }
      }
    }
  }

  return issues
}
