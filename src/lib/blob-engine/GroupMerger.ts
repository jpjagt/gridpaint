/**
 * GroupMerger - Handles multi-group primitive generation, merging, and override application
 *
 * Pipeline:
 * 1. Generate primitives per interaction group (independent neighborhood analysis)
 * 2. Apply per-point quadrant overrides
 * 3. Merge across groups using "most filled wins" union resolution
 * 4. Recompute rectangle curveTypes based on the merged filled-quadrant set
 */

import type {
  GridPoint,
  GridLayer,
  BlobPrimitive,
  PrimitiveType,
  CurveType,
  Quadrant,
  NeighborAnalysis,
  BlobGeometry,
} from "./types"
import { getGridLayerPoints } from "./types"
import type {
  InteractionGroup,
  PointModifications,
  QuadrantState,
  QuadrantOverrides,
  ValidationIssue,
} from "@/types/gridpaint"
import { NeighborhoodAnalyzer } from "./NeighborhoodAnalyzer"
import { PrimitiveGenerator } from "./PrimitiveGenerator"

/** Priority for union resolution: higher = "more filled" */
const PRIMITIVE_PRIORITY: Record<PrimitiveType, number> = {
  rectangle: 3,
  diagonalBridge: 2,
  roundedCorner: 1,
}

/**
 * Map from QuadrantState to the PrimitiveType + CurveType + renderQuadrant it produces.
 * Returns null for "empty" (no primitive rendered).
 * The renderQuadrant determines the visual orientation (rotation) of the shape,
 * which may differ from the physical quadrant it's placed in.
 */
function quadrantStateToPrimitive(
  state: QuadrantState,
): { type: PrimitiveType; curveType: CurveType; renderQuadrant: Quadrant } | null {
  switch (state) {
    case "full":
      // curveType will be recomputed later based on merged neighborhood
      // renderQuadrant doesn't matter for rectangles (symmetric)
      return { type: "rectangle", curveType: "none", renderQuadrant: 0 }
    case "empty":
      return null
    case "convex-se":
      return { type: "roundedCorner", curveType: "convex-south-east", renderQuadrant: 0 }
    case "convex-sw":
      return { type: "roundedCorner", curveType: "convex-south-west", renderQuadrant: 1 }
    case "convex-nw":
      return { type: "roundedCorner", curveType: "convex-north-west", renderQuadrant: 2 }
    case "convex-ne":
      return { type: "roundedCorner", curveType: "convex-north-east", renderQuadrant: 3 }
    case "concave-se":
      return { type: "diagonalBridge", curveType: "convex-south-east", renderQuadrant: 0 }
    case "concave-sw":
      return { type: "diagonalBridge", curveType: "convex-south-west", renderQuadrant: 1 }
    case "concave-nw":
      return { type: "diagonalBridge", curveType: "convex-north-west", renderQuadrant: 2 }
    case "concave-ne":
      return { type: "diagonalBridge", curveType: "convex-north-east", renderQuadrant: 3 }
  }
}

export class GroupMerger {
  private analyzer = new NeighborhoodAnalyzer()
  private generator = new PrimitiveGenerator()

  /**
   * Generate merged primitives for a layer with multiple groups.
   * This is the main entry point that replaces the simple per-layer generation
   * when groups or overrides are present.
   */
  generateMergedPrimitives(
    layer: GridLayer,
    gridSize: number,
    borderWidth: number,
  ): { primitives: BlobPrimitive[]; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = []
    const groups = layer.groups
    const pointMods = layer.pointModifications

    // Compute the union of all group points for override-only detection
    const allGroupPoints = getGridLayerPoints(layer)

    // Step 1: Generate primitives per group independently
    const allGroupPrimitives: Map<string, BlobPrimitive>[] = []
    for (const group of groups) {
      const groupPrims = this.generateGroupPrimitives(
        group,
        gridSize,
        borderWidth,
        layer.id,
      )
      allGroupPrimitives.push(groupPrims)
    }

    // Step 2: Merge across groups (union resolution)
    const merged = this.mergeGroupPrimitives(allGroupPrimitives)

    // Step 3: Apply per-point quadrant overrides
    if (pointMods && pointMods.size > 0) {
      this.applyQuadrantOverrides(merged, pointMods, gridSize, layer.id, issues, allGroupPoints)
    }

    // Step 4: Recompute rectangle curveTypes based on merged filled state
    this.recomputeRectangleCurveTypes(merged, layer)

    return { primitives: Array.from(merged.values()), issues }
  }

  /**
   * Generate primitives for a single interaction group.
   * Returns a map keyed by "x,y:quadrant" for easy merging.
   */
  private generateGroupPrimitives(
    group: InteractionGroup,
    gridSize: number,
    borderWidth: number,
    layerId: number,
  ): Map<string, BlobPrimitive> {
    const result = new Map<string, BlobPrimitive>()
    const pointsToProcess = this.analyzer.getPointsNeedingCalculation(group.points)

    for (const pointKey of pointsToProcess) {
      const [x, y] = pointKey.split(",").map(Number)
      const point: GridPoint = { x, y }
      const neighborhood = this.analyzer.getNeighborhoodMap(point, group.points)
      const analysis = this.analyzer.analyzeNeighborhood(
        neighborhood,
        group.points,
        point,
      )
      const isActivePoint = group.points.has(pointKey)

      // Classify each quadrant
      const quadrantTypes: (PrimitiveType | null)[] = []
      for (let q = 0; q < 4; q++) {
        quadrantTypes.push(
          this.analyzer.classifyQuadrant(
            neighborhood,
            q as Quadrant,
            isActivePoint,
          ),
        )
      }

      // Generate primitives
      const pointPrimitives = this.generator.generatePrimitivesForPoint(
        point,
        quadrantTypes,
        gridSize,
        borderWidth,
        layerId,
        isActivePoint,
        analysis,
      )

      for (const prim of pointPrimitives) {
        const key = `${prim.center.x},${prim.center.y}:${prim.quadrant}`
        result.set(key, prim)
      }
    }

    return result
  }

  /**
   * Merge primitives from multiple groups using "most filled wins" union.
   * For each (point, quadrant) slot, keep the primitive with the highest priority.
   */
  private mergeGroupPrimitives(
    allGroupPrimitives: Map<string, BlobPrimitive>[],
  ): Map<string, BlobPrimitive> {
    const merged = new Map<string, BlobPrimitive>()

    for (const groupMap of allGroupPrimitives) {
      for (const [key, prim] of groupMap) {
        const existing = merged.get(key)
        if (!existing || PRIMITIVE_PRIORITY[prim.type] > PRIMITIVE_PRIORITY[existing.type]) {
          merged.set(key, prim)
        }
      }
    }

    return merged
  }

  /**
   * Apply quadrant overrides from pointModifications.
   * Mutates the merged map in place.
   *
   * For points that only have overrides (not present in any group's points),
   * any neighborhood-analysis-generated primitives (e.g. diagonalBridge) are
   * cleared for that point before applying the explicit overrides. This ensures
   * diagonal bridges only appear for proper full group points.
   */
  private applyQuadrantOverrides(
    merged: Map<string, BlobPrimitive>,
    pointMods: Map<string, PointModifications>,
    gridSize: number,
    layerId: number,
    issues: ValidationIssue[],
    groupPoints: Set<string>,
  ): void {
    for (const [pointKey, mods] of pointMods) {
      if (!mods.quadrantOverrides) continue

      const [x, y] = pointKey.split(",").map(Number)
      const point: GridPoint = { x, y }
      const overrides = mods.quadrantOverrides

      // If this point is not a proper group point (override-only), remove any
      // neighborhood-generated primitives (e.g. diagonalBridge) for this point
      // before applying the explicit overrides.
      const isOverrideOnly = !groupPoints.has(pointKey)
      if (isOverrideOnly) {
        for (let q = 0; q < 4; q++) {
          merged.delete(`${x},${y}:${q}`)
        }
      }

      for (let q = 0; q < 4; q++) {
        const override = overrides[q as keyof QuadrantOverrides]
        if (override === undefined) continue

        const key = `${x},${y}:${q}`
        const converted = quadrantStateToPrimitive(override)

        if (converted === null) {
          // "empty" override: remove the primitive
          merged.delete(key)
        } else {
          // For non-"full" overrides, set renderQuadrant so the renderer
          // draws the shape in the user's selected direction, not the quadrant's
          // natural direction.
          const isFullOverride = converted.type === "rectangle"
          merged.set(key, {
            type: converted.type,
            center: point,
            quadrant: q as Quadrant,
            size: gridSize / 2,
            layerId,
            curveType: converted.curveType,
            renderQuadrant: isFullOverride ? undefined : converted.renderQuadrant,
          })
        }
      }
    }
  }

  /**
   * Recompute curveType for all rectangle primitives based on the merged state.
   * After merging groups and applying overrides, the exposed edges of rectangles
   * may have changed. This recalculates which edge is the outer boundary.
   */
  private recomputeRectangleCurveTypes(
    merged: Map<string, BlobPrimitive>,
    layer: GridLayer,
  ): void {
    // Build two sets:
    // - rectFilled: quadrants filled by rectangles (fully cover their cell-boundary edge)
    // - curveFilled: quadrants filled by curved primitives (diagonalBridge or roundedCorner)
    //   These render an arc through the corner region, suppressing the straight edge on the
    //   adjacent rectangle when one orthogonal neighbor is also present.
    const rectFilled = new Set<string>()
    const curveFilled = new Set<string>()
    for (const [key, prim] of merged) {
      if (prim.type === "rectangle") {
        rectFilled.add(key)
      } else if (prim.type === "diagonalBridge" || prim.type === "roundedCorner") {
        curveFilled.add(key)
      }
    }

    // For each rectangle, determine exposed edges
    for (const [key, prim] of merged) {
      if (prim.type !== "rectangle") continue

      const { x, y } = prim.center
      const q = prim.quadrant

      // Determine which neighboring quadrants exist in the merged set
      const curveType = this.computeMergedRectangleCurveType(
        x, y, q, rectFilled, curveFilled,
      )
      prim.curveType = curveType
    }
  }

  /**
   * Compute the curveType for a rectangle quadrant based on what neighboring
   * quadrants are filled in the merged set.
   *
   * A rectangle quadrant has an exposed edge if the adjacent rectangle across
   * that edge is NOT present. Only rectangles fully cover a cell-boundary edge.
   *
   * A diagonalBridge at the diagonal position renders an arc through the corner
   * of two adjacent shapes — when a diagonalBridge exists at the diagonal AND
   * one orthogonal rectangle neighbor is present, the bridge arc covers the
   * transition and the straight edge is suppressed.
   *
   * @param rectFilled  - quadrants occupied by rectangles (for orthogonal edge checks)
   * @param curveFilled - quadrants occupied by diagonalBridges or roundedCorners (for diagonal suppression)
   */
  private computeMergedRectangleCurveType(
    x: number,
    y: number,
    quadrant: Quadrant,
    rectFilled: Set<string>,
    curveFilled: Set<string>,
  ): CurveType {
    // Each quadrant borders two edges. Check if the neighbor across each edge is
    // a rectangle (fully covers the cell-boundary edge).
    // Quadrant layout:
    //   NW(2) | NE(3)
    //   ------+------
    //   SW(1) | SE(0)

    if (quadrant === 0) {
      // SE: south edge borders (x, y+1) NE quadrant; east edge borders (x+1, y) SW quadrant
      const hasSouth = rectFilled.has(`${x},${y + 1}:3`) // NE rect of cell below
      const hasEast = rectFilled.has(`${x + 1},${y}:1`)  // SW rect of cell right
      const hasDiag = curveFilled.has(`${x + 1},${y + 1}:2`) // NW curve of diag cell
      if (hasSouth && hasEast) return "none"
      if (hasDiag && (hasSouth || hasEast)) return "none" // Bridge arc covers corner
      if (!hasEast && hasSouth) return "line-east"
      if (hasEast && !hasSouth) return "line-south"
      if (hasDiag) return "none" // Only diagonal — bridge resolves
    }

    if (quadrant === 1) {
      // SW: south edge borders (x, y+1) NW quadrant; west edge borders (x-1, y) SE quadrant
      const hasSouth = rectFilled.has(`${x},${y + 1}:2`) // NW rect of cell below
      const hasWest = rectFilled.has(`${x - 1},${y}:0`)  // SE rect of cell left
      const hasDiag = curveFilled.has(`${x - 1},${y + 1}:3`) // NE curve of diag cell
      if (hasSouth && hasWest) return "none"
      if (hasDiag && (hasSouth || hasWest)) return "none" // Bridge arc covers corner
      if (!hasSouth && hasWest) return "line-south"
      if (hasSouth && !hasWest) return "line-west"
      if (hasDiag) return "none" // Only diagonal — bridge resolves
    }

    if (quadrant === 2) {
      // NW: north edge borders (x, y-1) SW quadrant; west edge borders (x-1, y) NE quadrant
      const hasNorth = rectFilled.has(`${x},${y - 1}:1`) // SW rect of cell above
      const hasWest = rectFilled.has(`${x - 1},${y}:3`)  // NE rect of cell left
      const hasDiag = curveFilled.has(`${x - 1},${y - 1}:0`) // SE curve of diag cell
      if (hasWest && hasNorth) return "none"
      if (hasDiag && (hasWest || hasNorth)) return "none" // Bridge arc covers corner
      if (!hasWest && hasNorth) return "line-west"
      if (hasWest && !hasNorth) return "line-north"
      if (hasDiag) return "none" // Only diagonal — bridge resolves
    }

    if (quadrant === 3) {
      // NE: north edge borders (x, y-1) SE quadrant; east edge borders (x+1, y) NW quadrant
      const hasNorth = rectFilled.has(`${x},${y - 1}:0`) // SE rect of cell above
      const hasEast = rectFilled.has(`${x + 1},${y}:2`)  // NW rect of cell right
      const hasDiag = curveFilled.has(`${x + 1},${y - 1}:1`) // SW curve of diag cell
      if (hasNorth && hasEast) return "none"
      if (hasDiag && (hasNorth || hasEast)) return "none" // Bridge arc covers corner
      if (!hasNorth && hasEast) return "line-north"
      if (hasNorth && !hasEast) return "line-east"
      if (hasDiag) return "none" // Only diagonal — bridge resolves
    }

    return "none"
  }

  clearCache(): void {
    this.analyzer.clearCache()
  }
}
