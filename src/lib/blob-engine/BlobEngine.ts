/**
 * BlobEngine - Main orchestrator for blob geometry generation
 *
 * This is the primary class that coordinates neighborhood analysis, primitive generation,
 * and caching to produce optimized blob geometry for rendering.
 */

import type {
  GridPoint,
  GridLayer,
  BlobGeometry,
  BlobPrimitive,
  SpatialRegion,
  LayerGeometry,
  CompositeGeometry,
  PrimitiveType,
  NeighborAnalysis,
} from "./types"

import { NeighborhoodAnalyzer } from "./NeighborhoodAnalyzer"
import { PrimitiveGenerator } from "./PrimitiveGenerator"
import { GeometryCache } from "./GeometryCache"
import { BlobEngineError } from "./types"

export interface BlobEngineOptions {
  enableCaching?: boolean
  maxCacheSize?: number
  debugMode?: boolean
}

const logPointInfo = (
  point: GridPoint,
  neighborhood: boolean[][],
  analysis: any,
  pointPrimitives: BlobPrimitive[],
) => {
  // Print neighborhood with proper orientation
  console.log(`Neighborhood at (${point.x}, ${point.y}):`)

  // Transpose the matrix to get correct x/y orientation
  // Loop through rows from top to bottom (y axis, decreasing)
  let output = ""
  for (let dy = -1; dy <= 1; dy++) {
    let row = ""
    for (let dx = -1; dx <= 1; dx++) {
      // neighborhood[dx+1][dy+1] corresponds to the correct position
      row += neighborhood[dx + 1][dy + 1] ? "■ " : "□ "
    }
    output += row.trim() + "\n"
  }
  console.log(output)
  console.log({ analysis })
  console.log(
    `${pointPrimitives.length} primitives:\n`,
    pointPrimitives
      .map(
        (p) =>
          `- ${p.type} @ ${
            {
              0: "SE",
              1: "SW",
              2: "NW",
              3: "NE",
            }[p.quadrant]
          }, CurveType: ${p.curveType}`,
      )
      .join("\n"),
  )
}

export class BlobEngine {
  private analyzer = new NeighborhoodAnalyzer()
  private generator = new PrimitiveGenerator()
  private cache = new GeometryCache()

  private options: BlobEngineOptions

  constructor(options: BlobEngineOptions = {}) {
    this.options = {
      enableCaching: true,
      maxCacheSize: 1000,
      debugMode: false,
      ...options,
    }
  }

  /**
   * Generate complete blob geometry for a set of layers
   * This is the main API method used by renderers
   */
  generateGeometry(
    layers: GridLayer[],
    gridSize: number,
    borderWidth: number = 0,
    viewport?: SpatialRegion,
  ): CompositeGeometry {
    try {
      const startTime = this.options.debugMode ? performance.now() : 0

      // Filter to visible layers only
      const visibleLayers = layers.filter((layer) => layer.isVisible)

      if (visibleLayers.length === 0) {
        return this.createEmptyGeometry()
      }

      // Generate geometry for each layer
      const layerGeometries: LayerGeometry[] = []
      let totalPrimitives = 0
      let globalMinX = Infinity,
        globalMinY = Infinity
      let globalMaxX = -Infinity,
        globalMaxY = -Infinity

      for (const layer of visibleLayers) {
        const geometry = this.generateLayerGeometry(
          layer,
          gridSize,
          borderWidth,
          viewport,
        )

        layerGeometries.push({
          layer,
          geometry,
          renderOrder: 6 - layer.id, // Higher layer IDs render on top
        })

        totalPrimitives += geometry.primitives.length

        // Update global bounds
        if (geometry.primitives.length > 0) {
          globalMinX = Math.min(globalMinX, geometry.boundingBox.min.x)
          globalMinY = Math.min(globalMinY, geometry.boundingBox.min.y)
          globalMaxX = Math.max(globalMaxX, geometry.boundingBox.max.x)
          globalMaxY = Math.max(globalMaxY, geometry.boundingBox.max.y)
        }
      }

      // Sort layers by render order (background to foreground)
      layerGeometries.sort((a, b) => a.renderOrder - b.renderOrder)

      const result: CompositeGeometry = {
        layers: layerGeometries,
        boundingBox:
          totalPrimitives > 0
            ? {
                min: { x: globalMinX, y: globalMinY },
                max: { x: globalMaxX, y: globalMaxY },
              }
            : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
        totalPrimitives,
      }

      if (this.options.debugMode) {
        const duration = performance.now() - startTime
        console.log(
          `BlobEngine.generateGeometry: ${duration.toFixed(2)}ms, ${totalPrimitives} primitives`,
        )
      }

      return result
    } catch (error) {
      throw new BlobEngineError(
        `Failed to generate geometry: ${error instanceof Error ? error.message : "Unknown error"}`,
        "GENERATION_ERROR",
      )
    }
  }

  /**
   * Generate geometry for a single layer
   */
  generateLayerGeometry(
    layer: GridLayer,
    gridSize: number,
    borderWidth: number = 0,
    viewport?: SpatialRegion,
  ): BlobGeometry {
    if (!layer.isVisible || layer.points.size === 0) {
      return this.createEmptyLayerGeometry(gridSize, borderWidth)
    }

    // Determine points that need processing
    const pointsToProcess = viewport
      ? this.getViewportPoints(layer, viewport)
      : this.getAllLayerPoints(layer)

    if (pointsToProcess.size === 0) {
      return this.createEmptyLayerGeometry(gridSize, borderWidth)
    }

    // Try cache if enabled
    if (this.options.enableCaching && viewport) {
      const cacheResult = this.cache.getCachedGeometry(
        viewport,
        [layer],
        gridSize,
        borderWidth,
      )
      if (cacheResult.hit) {
        return this.createGeometryFromPrimitives(
          cacheResult.geometry,
          gridSize,
          borderWidth,
        )
      }
    }

    // Generate primitives for all points
    const primitives: BlobPrimitive[] = []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity

    for (const pointKey of pointsToProcess) {
      const [x, y] = pointKey.split(",").map(Number)
      const point: GridPoint = { x, y }

      // Get neighborhood and analyze it
      const neighborhood = this.analyzer.getNeighborhoodMap(point, layer.points)
      const analysis = this.analyzer.analyzeNeighborhood(
        neighborhood,
        layer.points,
        point,
      )

      const isActivePoint = layer.points.has(pointKey)

      // Generate primitives for each quadrant
      const pointPrimitives = this.generatePointPrimitives(
        point,
        neighborhood,
        isActivePoint,
        gridSize,
        borderWidth,
        layer.id,
        analysis,
      )

      logPointInfo(point, neighborhood, analysis, pointPrimitives)

      primitives.push(...pointPrimitives)

      // Update bounds
      if (pointPrimitives.length > 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }

    const geometry: BlobGeometry = {
      primitives,
      boundingBox:
        primitives.length > 0
          ? {
              min: { x: minX, y: minY },
              max: { x: maxX, y: maxY },
            }
          : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      gridSize,
      borderWidth,
    }

    // Cache the result if enabled
    if (this.options.enableCaching && viewport) {
      // TODO: Implement region-based caching
      // For now, skip caching to avoid complexity
    }

    return geometry
  }

  /**
   * Generate primitives for a single point
   */
  private generatePointPrimitives(
    point: GridPoint,
    neighborhood: boolean[][],
    isActivePoint: boolean,
    gridSize: number,
    borderWidth: number,
    layerId: number,
    analysis: NeighborAnalysis,
  ): BlobPrimitive[] {
    const primitives: BlobPrimitive[] = []
    const quadrantTypes: (PrimitiveType | null)[] = []

    // Classify each quadrant
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const primitiveType = this.analyzer.classifyQuadrant(
        neighborhood,
        quadrant as 0 | 1 | 2 | 3,
        isActivePoint,
      )
      quadrantTypes.push(primitiveType)
    }

    // Generate primitives using the generator
    return this.generator.generatePrimitivesForPoint(
      point,
      quadrantTypes,
      gridSize,
      borderWidth,
      layerId,
      isActivePoint,
      analysis,
    )
  }

  /**
   * Get all points that need processing for a layer, including neighbors for bridges
   */
  private getAllLayerPoints(layer: GridLayer): Set<string> {
    return this.analyzer.getPointsNeedingCalculation(layer.points)
  }

  /**
   * Get points within viewport bounds
   */
  private getViewportPoints(
    layer: GridLayer,
    viewport: SpatialRegion,
  ): Set<string> {
    const allPoints = this.getAllLayerPoints(layer)
    const viewportPoints = new Set<string>()

    for (const pointKey of allPoints) {
      const [x, y] = pointKey.split(",").map(Number)
      if (
        x >= viewport.minX &&
        x <= viewport.maxX &&
        y >= viewport.minY &&
        y <= viewport.maxY
      ) {
        viewportPoints.add(pointKey)
      }
    }

    return viewportPoints
  }

  /**
   * Create empty geometry structures
   */
  private createEmptyGeometry(): CompositeGeometry {
    return {
      layers: [],
      boundingBox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      totalPrimitives: 0,
    }
  }

  private createEmptyLayerGeometry(
    gridSize: number,
    borderWidth: number,
  ): BlobGeometry {
    return {
      primitives: [],
      boundingBox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      gridSize,
      borderWidth,
    }
  }

  private createGeometryFromPrimitives(
    primitives: BlobPrimitive[],
    gridSize: number,
    borderWidth: number,
  ): BlobGeometry {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity

    for (const primitive of primitives) {
      minX = Math.min(minX, primitive.center.x)
      minY = Math.min(minY, primitive.center.y)
      maxX = Math.max(maxX, primitive.center.x)
      maxY = Math.max(maxY, primitive.center.y)
    }

    return {
      primitives,
      boundingBox:
        primitives.length > 0
          ? {
              min: { x: minX, y: minY },
              max: { x: maxX, y: maxY },
            }
          : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      gridSize,
      borderWidth,
    }
  }

  /**
   * Invalidate cached geometry for a layer
   */
  invalidateLayer(layerId: number, affectedRegion?: SpatialRegion): void {
    if (this.options.enableCaching) {
      this.cache.invalidateLayer(layerId, affectedRegion)
    }

    // Also clear analyzer caches since layer data changed
    this.analyzer.clearCache()
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.cache.clear()
    this.analyzer.clearCache()
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      cache: this.cache.getStats(),
      options: this.options,
    }
  }

  /**
   * Update engine options
   */
  updateOptions(options: Partial<BlobEngineOptions>): void {
    this.options = { ...this.options, ...options }
  }
}
