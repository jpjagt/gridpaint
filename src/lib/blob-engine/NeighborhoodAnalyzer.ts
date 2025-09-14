/**
 * NeighborhoodAnalyzer - Efficient 8-directional neighbor detection and primitive classification
 *
 * This class analyzes the 3x3 Moore neighborhood around each grid point and determines
 * what type of blob primitive should be rendered for each quadrant.
 */

import type {
  GridPoint,
  GridLayer,
  NeighborhoodMap,
  NeighborAnalysis,
  PrimitiveType,
} from "./types"

import { QUADRANT_NEIGHBOR_PATTERNS } from "./types"

export class NeighborhoodAnalyzer {
  private neighborCache = new Map<string, NeighborhoodMap>()
  private analysisCache = new Map<string, NeighborAnalysis>()

  /**
   * Get the 3x3 neighborhood map for a point within a specific layer
   */
  getNeighborhoodMap(
    point: GridPoint,
    layerPoints: Set<string>,
  ): NeighborhoodMap {
    const cacheKey = this.generateNeighborhoodCacheKey(point, layerPoints)

    if (this.neighborCache.has(cacheKey)) {
      return this.neighborCache.get(cacheKey)!
    }

    const neighborhood: NeighborhoodMap = [
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]

    // Check each position in the 3x3 grid
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighborX = point.x + dx
        const neighborY = point.y + dy
        const neighborKey = `${neighborX},${neighborY}`

        // Check if this layer has this point
        const hasNeighbor = layerPoints.has(neighborKey)
        neighborhood[dx + 1][dy + 1] = hasNeighbor
      }
    }

    this.neighborCache.set(cacheKey, neighborhood)
    return neighborhood
  }

  /**
   * Analyze neighborhood to extract directional information and adjacent bridge info
   */
  analyzeNeighborhood(
    neighborhood: NeighborhoodMap,
    layerPoints: Set<string>,
    centerPoint: GridPoint,
  ): NeighborAnalysis {
    const cacheKey = `${this.serializeNeighborhood(neighborhood)}:${centerPoint.x},${centerPoint.y}`

    if (this.analysisCache.has(cacheKey)) {
      return this.analysisCache.get(cacheKey)!
    }

    const analysis: NeighborAnalysis = {
      // 8-directional neighbors
      north: neighborhood[1][0],
      northeast: neighborhood[2][0],
      east: neighborhood[2][1],
      southeast: neighborhood[2][2],
      south: neighborhood[1][2],
      southwest: neighborhood[0][2],
      west: neighborhood[0][1],
      northwest: neighborhood[0][0],

      // Convenience properties
      hasOrthogonal:
        neighborhood[1][0] ||
        neighborhood[2][1] ||
        neighborhood[1][2] ||
        neighborhood[0][1],
      hasDiagonal:
        neighborhood[2][0] ||
        neighborhood[2][2] ||
        neighborhood[0][2] ||
        neighborhood[0][0],
      isIsolated:
        !neighborhood[1][0] &&
        !neighborhood[2][1] &&
        !neighborhood[1][2] &&
        !neighborhood[0][1] &&
        !neighborhood[2][0] &&
        !neighborhood[2][2] &&
        !neighborhood[0][2] &&
        !neighborhood[0][0],

      // Calculate adjacent bridge information
      adjacentBridges: this.computeAdjacentBridges(centerPoint, layerPoints),
    }

    this.analysisCache.set(cacheKey, analysis)
    return analysis
  }

  /**
   * Classify what type of primitive should be rendered for a specific quadrant
   * Based on the mathematical specification in the blob rendering docs
   */
  classifyQuadrant(
    neighborhood: NeighborhoodMap,
    quadrant: 0 | 1 | 2 | 3,
    isCenter: boolean,
  ): PrimitiveType | null {
    // If the center point is not active, check for diagonal bridges
    if (!isCenter) {
      return this.checkDiagonalBridge(neighborhood, quadrant)
    }

    // For active center points, check the 3 neighbors in the quadrant direction
    const pattern = QUADRANT_NEIGHBOR_PATTERNS[quadrant]
    const [orthogonal1, diagonal, orthogonal2] = pattern.map(
      ([dx, dy]) => neighborhood[dx + 1][dy + 1],
    )

    // Element 0 (Rectangle): Has orthogonal connection in quadrant direction
    if (orthogonal1 || orthogonal2 || diagonal) {
      return "rectangle"
    }

    // Element 1 (Rounded Corner): No connections in quadrant direction
    return "roundedCorner"
  }

  /**
   * Check if a diagonal bridge should be rendered for an inactive point
   */
  private checkDiagonalBridge(
    neighborhood: NeighborhoodMap,
    quadrant: 0 | 1 | 2 | 3,
  ): PrimitiveType | null {
    // Bridge patterns for each quadrant
    const bridgePatterns = [
      // SE: check if E and S are both active
      () => neighborhood[2][1] && neighborhood[1][2],
      // SW: check if S and W are both active
      () => neighborhood[1][2] && neighborhood[0][1],
      // NW: check if W and N are both active
      () => neighborhood[0][1] && neighborhood[1][0],
      // NE: check if N and E are both active
      () => neighborhood[1][0] && neighborhood[2][1],
    ]

    return bridgePatterns[quadrant]() ? "diagonalBridge" : null
  }

  /**
   * Compute what diagonal bridges adjacent cells will render
   */
  private computeAdjacentBridges(
    centerPoint: GridPoint,
    layerPoints: Set<string>,
  ): NeighborAnalysis["adjacentBridges"] {
    const { x, y } = centerPoint

    // Helper to check if an adjacent cell will render a diagonal bridge in a specific quadrant
    const willRenderBridge = (adjX: number, adjY: number, quadrant: 0 | 1 | 2 | 3): boolean => {
      const adjNeighborhood = this.getNeighborhoodMap({ x: adjX, y: adjY }, layerPoints)
      const isAdjActive = layerPoints.has(`${adjX},${adjY}`)
      return this.checkDiagonalBridge(adjNeighborhood, quadrant) === "diagonalBridge"
    }

    return {
      // North cell (x, y-1) rendering in its south quadrants (SE=0, SW=1)
      northEast: willRenderBridge(x, y - 1, 0), // SE quadrant
      northWest: willRenderBridge(x, y - 1, 1), // SW quadrant

      // South cell (x, y+1) rendering in its north quadrants (NE=3, NW=2)
      southEast: willRenderBridge(x, y + 1, 3), // NE quadrant
      southWest: willRenderBridge(x, y + 1, 2), // NW quadrant

      // East cell (x+1, y) rendering in its west quadrants (NW=2, SW=1)
      eastNorth: willRenderBridge(x + 1, y, 2), // NW quadrant
      eastSouth: willRenderBridge(x + 1, y, 1), // SW quadrant

      // West cell (x-1, y) rendering in its east quadrants (NE=3, SE=0)
      westNorth: willRenderBridge(x - 1, y, 3), // NE quadrant
      westSouth: willRenderBridge(x - 1, y, 0), // SE quadrant
    }
  }

  /**
   * Get all points that need geometry calculation for a given layer
   * This includes active points and their neighbors (for bridge detection)
   */
  getPointsNeedingCalculation(layerPoints: Set<string>): Set<string> {
    const points = new Set<string>()

    // Add all active points
    for (const pointKey of layerPoints) {
      points.add(pointKey)

      // Add 3x3 neighborhood for bridge detection
      const [x, y] = pointKey.split(",").map(Number)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          points.add(`${x + dx},${y + dy}`)
        }
      }
    }

    return points
  }

  /**
   * Check if a specific point should render anything for the given layer
   */
  shouldRenderPoint(point: GridPoint, layerPoints: Set<string>): boolean {
    const pointKey = `${point.x},${point.y}`

    // Check if point is active in this layer
    if (layerPoints.has(pointKey)) {
      return true
    }

    // Check if point should render bridges
    const neighborhood = this.getNeighborhoodMap(point, layerPoints)
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      if (
        this.classifyQuadrant(
          neighborhood,
          quadrant as 0 | 1 | 2 | 3,
          false,
        ) === "diagonalBridge"
      ) {
        return true
      }
    }

    return false
  }

  /**
   * Clear caches (call when layer data changes significantly)
   */
  clearCache(): void {
    this.neighborCache.clear()
    this.analysisCache.clear()
  }

  /**
   * Generate cache key for neighborhood lookup
   */
  private generateNeighborhoodCacheKey(
    point: GridPoint,
    layerPoints: Set<string>,
  ): string {
    // Create a hash of the layer points for caching
    const sortedPoints = Array.from(layerPoints).sort()
    const pointsHash = sortedPoints.slice(0, 10).join(",") // Limit for performance

    return `${point.x},${point.y}:${pointsHash.length}:${sortedPoints.length}`
  }

  /**
   * Serialize neighborhood map for caching
   */
  private serializeNeighborhood(neighborhood: NeighborhoodMap): string {
    return neighborhood
      .map((row) => row.map((cell) => (cell ? "1" : "0")).join(""))
      .join("")
  }
}
