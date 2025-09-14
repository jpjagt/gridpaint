/**
 * PrimitiveGenerator - Creates geometric primitives for blob rendering
 *
 * This class generates the three types of blob primitives based on the mathematical
 * specification: rectangles, rounded corners, and diagonal bridges.
 */

import type {
  GridPoint,
  BlobPrimitive,
  PrimitiveType,
  CurveType,
  NeighborAnalysis,
} from "./types"
import { QUADRANT_NEIGHBOR_PATTERNS } from "./types"
import {
  GeometricPath,
  generateRectanglePath,
  generateRoundedCornerPath,
  generateDiagonalBridgePath,
} from "./utils/curveUtils"

export class PrimitiveGenerator {
  /**
   * Generate a rectangle primitive (Element 0)
   * Used when orthogonal connections exist in the quadrant direction
   */
  generateRectangle(
    center: GridPoint,
    quadrant: 0 | 1 | 2 | 3,
    gridSize: number,
    borderWidth: number,
    layerId: number,
    curveType: CurveType,
  ): BlobPrimitive {
    const size = gridSize / 2

    return {
      type: "rectangle",
      center,
      quadrant,
      size,
      layerId,
      curveType,
    }
  }

  /**
   * Generate a rounded corner primitive (Element 1)
   * Used when no connections exist in the quadrant direction
   */
  generateRoundedCorner(
    center: GridPoint,
    quadrant: 0 | 1 | 2 | 3,
    gridSize: number,
    borderWidth: number,
    layerId: number,
  ): BlobPrimitive {
    const size = gridSize / 2

    const curveType: CurveType = (() => {
      switch (quadrant) {
        case 0:
          return "convex-south-east"
        case 1:
          return "convex-south-west"
        case 2:
          return "convex-north-west"
        case 3:
          return "convex-north-east"
      }
    })()

    return {
      type: "roundedCorner",
      center,
      quadrant,
      size,
      layerId,
      curveType,
    }
  }

  /**
   * Generate a diagonal bridge primitive (Element 2)
   * Used for connecting diagonal neighbors across empty space
   * These are convex curves drawn from the empty point's perspective
   */
  generateDiagonalBridge(
    center: GridPoint,
    quadrant: 0 | 1 | 2 | 3,
    gridSize: number,
    borderWidth: number,
    layerId: number,
  ): BlobPrimitive {
    const size = gridSize / 2

    const curveType: CurveType = (() => {
      switch (quadrant) {
        case 0:
          return "convex-south-east"
        case 1:
          return "convex-south-west"
        case 2:
          return "convex-north-west"
        case 3:
          return "convex-north-east"
      }
    })()

    return {
      type: "diagonalBridge",
      center,
      quadrant,
      size,
      layerId,
      curveType,
    }
  }

  /**
   * Convert a primitive to a geometric path for rendering
   * This generates the actual path data that renderers can use
   */
  primitiveToPath(primitive: BlobPrimitive): GeometricPath {
    const { type, size } = primitive

    switch (type) {
      case "rectangle":
        return generateRectanglePath(0, 0, size, size)

      case "roundedCorner":
        return generateRoundedCornerPath(0, 0, size)

      case "diagonalBridge":
        return generateDiagonalBridgePath(0, 0, size)

      default:
        throw new Error(`Unknown primitive type: ${type}`)
    }
  }

  /**
   * Get the transformation matrix for a quadrant rotation
   * Quadrants: 0=SE(0°), 1=SW(90°), 2=NW(180°), 3=NE(270°)
   */
  getQuadrantTransform(quadrant: 0 | 1 | 2 | 3): { rotation: number } {
    const rotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    return { rotation: rotations[quadrant] }
  }

  /**
   * Calculate world position for a primitive
   * Converts grid coordinates to world coordinates for rendering
   */
  calculateWorldPosition(
    primitive: BlobPrimitive,
    gridSize: number,
  ): { x: number; y: number } {
    return {
      x: primitive.center.x * gridSize + gridSize / 2,
      y: primitive.center.y * gridSize + gridSize / 2,
    }
  }

  /**
   * Check if two primitives overlap (for optimization)
   */
  primitivesOverlap(a: BlobPrimitive, b: BlobPrimitive): boolean {
    // Simple bounding box check
    const aSize = a.size
    const bSize = b.size

    return (
      Math.abs(a.center.x - b.center.x) * 2 < aSize + bSize &&
      Math.abs(a.center.y - b.center.y) * 2 < aSize + bSize
    )
  }

  /**
   * Generate all primitives for a single point given its neighbor classification
   */
  generatePrimitivesForPoint(
    point: GridPoint,
    quadrantTypes: (PrimitiveType | null)[],
    gridSize: number,
    borderWidth: number,
    layerId: number,
    isActivePoint: boolean,
    analysis: NeighborAnalysis,
  ): BlobPrimitive[] {
    const primitives: BlobPrimitive[] = []

    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const primitiveType = quadrantTypes[quadrant]

      if (!primitiveType) continue

      let primitive: BlobPrimitive

      switch (primitiveType) {
        case "rectangle":
          // Determine which straight edge this quadrant contributes as an outer boundary
          // based on orthogonal neighbors in the quadrant direction.
          // Fallback to a deterministic edge when ambiguous.
          {
            const curveType = this.computeRectangleCurveType(
              quadrant as 0 | 1 | 2 | 3,
              analysis,
            )
            primitive = this.generateRectangle(
              point,
              quadrant as 0 | 1 | 2 | 3,
              gridSize,
              isActivePoint ? borderWidth : 0, // Only add border for active points
              layerId,
              curveType,
            )
          }
          break

        case "roundedCorner":
          primitive = this.generateRoundedCorner(
            point,
            quadrant as 0 | 1 | 2 | 3,
            gridSize,
            isActivePoint ? borderWidth : 0,
            layerId,
          )
          break

        case "diagonalBridge":
          primitive = this.generateDiagonalBridge(
            point,
            quadrant as 0 | 1 | 2 | 3,
            gridSize,
            0, // Bridges never have borders
            layerId,
          )
          break

        default:
          continue
      }

      primitives.push(primitive)
    }

    return primitives
  }

  /**
   * Compute CurveType for a rectangle quadrant based on neighbor analysis.
   * Returns a single straight edge direction or 'none' for interior blocks.
   * Now considers adjacent bridge information to avoid conflicts.
   */
  private computeRectangleCurveType(
    quadrant: 0 | 1 | 2 | 3,
    analysis: NeighborAnalysis,
  ): CurveType {
    const {
      east,
      west,
      north,
      south,
      northwest,
      northeast,
      southwest,
      southeast,
    } = analysis

    if (quadrant === 0) {
      // SE
      if (east && south) return "none" // Interior corner
      if (southeast) return "none" // Diagonal bridge resolves
      if (!east && south) return "line-east" // Missing east
      if (east && !south) return "line-south" // Missing south
    }

    if (quadrant === 1) {
      // SW
      if (south && west) return "none" // Interior corner
      if (southwest) return "none" // Diagonal bridge resolves
      if (!south && west) return "line-south" // Missing south
      if (south && !west) return "line-west" // Missing west
    }

    if (quadrant === 2) {
      // NW
      if (west && north) return "none" // Interior corner
      if (northwest) return "none" // Diagonal bridge resolves
      if (!west && north) return "line-west" // Missing west
      if (west && !north) return "line-north" // Missing north
    }

    if (quadrant === 3) {
      // NE
      if (north && east) return "none" // Interior corner
      if (northeast) return "none" // Diagonal bridge resolves
      if (!north && east) return "line-north" // Missing north
      if (north && !east) return "line-east" // Missing east
    }

    return "none" // Fallback (shouldn't happen)
  }
}
