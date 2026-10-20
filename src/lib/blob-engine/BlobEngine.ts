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
import { BlobEngineError } from "./types"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"

export interface BlobEngineOptions {
  /** @deprecated No-op: geometry caching now lives in TiledLayerGeometry */
  enableCaching?: boolean
  /** @deprecated No-op */
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
        )

        layerGeometries.push({
          layer,
          geometry,
          renderOrder: -layer.id, // Higher layer IDs render on top (any integer id)
        })

        totalPrimitives += geometry.primitives.length

        // Update global bounds. Per-layer scale is applied about the origin as
        // a render post-process, so the scaled bbox is the unscaled bbox times
        // the factor (both min and max scale).
        if (geometry.primitives.length > 0) {
          const sf = scaleToFactor(layer.scale)
          globalMinX = Math.min(globalMinX, geometry.boundingBox.min.x * sf)
          globalMinY = Math.min(globalMinY, geometry.boundingBox.min.y * sf)
          globalMaxX = Math.max(globalMaxX, geometry.boundingBox.max.x * sf)
          globalMaxY = Math.max(globalMaxY, geometry.boundingBox.max.y * sf)
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
  needsGroupMerge(layer: GridLayer): boolean {
    return (
      layer.groups.length > 1 ||
      (layer.pointModifications !== undefined && layer.pointModifications.size > 0) ||
      layer.groups.some(
        (g) => g.offsetPhaseX === "half" || g.offsetPhaseY === "half",
      )
    )
  }

  /**
   * Generate geometry for a single layer
   */
  generateLayerGeometry(
    layer: GridLayer,
    gridSize: number,
    borderWidth: number = 0,
    options: {
      /**
       * Take the group-merge path even if this layer alone wouldn't need it.
       * Used when generating a window of a larger layer, so the window
       * produces exactly the primitives the full layer would.
       */
      forceGroupMerge?: boolean
    } = {},
  ): BlobGeometry {
    const allLayerPoints = getGridLayerPoints(layer)
    const hasPointMods = layer.pointModifications !== undefined && layer.pointModifications.size > 0
    if (!layer.isVisible || (allLayerPoints.size === 0 && !hasPointMods)) {
      return this.createEmptyLayerGeometry(gridSize, borderWidth)
    }

    // Use GroupMerger path for multi-group layers or layers with overrides
    if (options.forceGroupMerge || this.needsGroupMerge(layer)) {
      const { primitives } = this.groupMerger.generateMergedPrimitives(
        layer,
        gridSize,
        borderWidth,
      )
      return this.createGeometryFromPrimitives(primitives, gridSize, borderWidth)
    }

    // Fast path: single group, no overrides
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

  /** @deprecated No-op: kept for callers from before TiledLayerGeometry */
  invalidateLayer(): void {}

  /** @deprecated No-op: kept for callers from before TiledLayerGeometry */
  clearCaches(): void {}

  /**
   * Update engine options
   */
  updateOptions(options: Partial<BlobEngineOptions>): void {
    this.options = { ...this.options, ...options }
  }
}
