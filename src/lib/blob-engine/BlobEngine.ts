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
import { getGridLayerPoints } from "./types"

import { NeighborhoodAnalyzer } from "./NeighborhoodAnalyzer"
import { PrimitiveGenerator } from "./PrimitiveGenerator"
import { GroupMerger } from "./GroupMerger"
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
  private groupMerger = new GroupMerger()
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
   * Check if a layer needs the multi-group merge path
   */
  private needsGroupMerge(layer: GridLayer): boolean {
    return (
      layer.groups.length > 1 ||
      (layer.pointModifications !== undefined && layer.pointModifications.size > 0)
    )
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
    const allLayerPoints = getGridLayerPoints(layer)
    const hasPointMods = layer.pointModifications !== undefined && layer.pointModifications.size > 0
    if (!layer.isVisible || (allLayerPoints.size === 0 && !hasPointMods)) {
      return this.createEmptyLayerGeometry(gridSize, borderWidth)
    }

    // Use GroupMerger path for multi-group layers or layers with overrides
    if (this.needsGroupMerge(layer)) {
      const { primitives } = this.groupMerger.generateMergedPrimitives(
        layer,
        gridSize,
        borderWidth,
      )
      return this.createGeometryFromPrimitives(primitives, gridSize, borderWidth)
    }

    // Fast path: single group, no overrides (original algorithm)
    // If caching and viewport provided, do region-based fetch/compute
    if (this.options.enableCaching && viewport) {
      const { geometry: hitPrimitives, hitRegions, missRegions } =
        this.cache.getCachedGeometry(viewport, [layer], gridSize, borderWidth)

      const resultPrimitives: BlobPrimitive[] = [...hitPrimitives]

      // Precompute candidate points within the overall viewport once
      const viewportPoints = this.getViewportPoints(layer, viewport)

      // Update layer version snapshot once for this round
      this.cache.snapshotLayerVersions([layer])

      // Compute primitives for each missed region and cache them
      for (const regionKey of missRegions) {
        const regionBounds = this.cache.getRegionBounds(regionKey)
        const pointsToProcess = this.filterPointsInRegion(viewportPoints, regionBounds)

        if (pointsToProcess.size === 0) {
          // Cache empty to avoid rework later
          this.cache.cacheRegionGeometry(regionKey, [], [layer])
          continue
        }

        const regionPrimitives: BlobPrimitive[] = []
        for (const pointKey of pointsToProcess) {
          const [x, y] = pointKey.split(",").map(Number)
          const point: GridPoint = { x, y }

          const neighborhood = this.analyzer.getNeighborhoodMap(
            point,
            allLayerPoints,
          )
          const analysis = this.analyzer.analyzeNeighborhood(
            neighborhood,
            allLayerPoints,
            point,
          )
          const isActivePoint = allLayerPoints.has(pointKey)

          const pointPrimitives = this.generatePointPrimitives(
            point,
            neighborhood,
            isActivePoint,
            gridSize,
            borderWidth,
            layer.id,
            analysis,
          )

          regionPrimitives.push(...pointPrimitives)
        }

        // Cache region results and add to final list
        this.cache.cacheRegionGeometry(regionKey, regionPrimitives, [layer])
        resultPrimitives.push(...regionPrimitives)
      }

      return this.createGeometryFromPrimitives(
        resultPrimitives,
        gridSize,
        borderWidth,
      )
    }

    // Fallback: no viewport or caching disabled → compute full set
    const pointsToProcess = this.getAllLayerPoints(layer)
    if (pointsToProcess.size === 0) {
      return this.createEmptyLayerGeometry(gridSize, borderWidth)
    }

    const primitives: BlobPrimitive[] = []
    for (const pointKey of pointsToProcess) {
      const [x, y] = pointKey.split(",").map(Number)
      const point: GridPoint = { x, y }
      const neighborhood = this.analyzer.getNeighborhoodMap(point, allLayerPoints)
      const analysis = this.analyzer.analyzeNeighborhood(
        neighborhood,
        allLayerPoints,
        point,
      )
      const isActivePoint = allLayerPoints.has(pointKey)
      const pointPrimitives = this.generatePointPrimitives(
        point,
        neighborhood,
        isActivePoint,
        gridSize,
        borderWidth,
        layer.id,
        analysis,
      )
      primitives.push(...pointPrimitives)
    }

    return this.createGeometryFromPrimitives(primitives, gridSize, borderWidth)
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
    return this.analyzer.getPointsNeedingCalculation(getGridLayerPoints(layer))
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
   * Get points within a specific region bounds
   */
  private getRegionPoints(layer: GridLayer, region: SpatialRegion): Set<string> {
    return this.getViewportPoints(layer, region)
  }

  private filterPointsInRegion(
    points: Set<string>,
    region: SpatialRegion,
  ): Set<string> {
    const subset = new Set<string>()
    for (const key of points) {
      const [x, y] = key.split(',').map(Number)
      if (
        x >= region.minX &&
        x <= region.maxX &&
        y >= region.minY &&
        y <= region.maxY
      ) {
        subset.add(key)
      }
    }
    return subset
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
    this.groupMerger.clearCache()
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.cache.clear()
    this.analyzer.clearCache()
    this.groupMerger.clearCache()
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
