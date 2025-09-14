/**
 * Canvas2DRenderer - High-performance Canvas 2D blob renderer
 *
 * This renderer converts blob primitives into Canvas 2D drawing operations
 * with optimizations for performance and visual quality.
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  CompositeGeometry,
  RenderStyle,
  GridPoint,
} from "../types"

import {
  Renderer,
  type ViewportTransform,
  type RenderOptions,
  RenderUtils,
} from "./Renderer"
import { PrimitiveGenerator } from "../PrimitiveGenerator"
import { magicNr } from "@/lib/constants"

// Debug visualization constants
let SHOW_SUBGRID = false // Set to true to show quadrant grid lines

// Border expansion control - positive values expand outward to create borders
const FEATHER_FACTOR = 0.1 // Factor to expand primitives outward for border effect (0 = no border)

interface RenderStats {
  primitivesRendered: number
  primitivesCulled: number
  renderTime: number
  lastFrameTime: number
}

export class Canvas2DRenderer extends Renderer {
  private ctx: CanvasRenderingContext2D | null = null
  private stats: RenderStats = {
    primitivesRendered: 0,
    primitivesCulled: 0,
    renderTime: 0,
    lastFrameTime: 0,
  }

  /**
   * Get the canvas context (for compatibility with existing code)
   */
  get context(): CanvasRenderingContext2D | null {
    return this.ctx
  }

  constructor(canvas: HTMLCanvasElement | null, debugMode: boolean = false) {
    super(debugMode)

    if (canvas) {
      this.setCanvas(canvas)
    }
  }

  /**
   * Set the canvas element to render to
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext("2d")

    if (this.ctx) {
      // Configure for crisp pixel rendering
      this.ctx.imageSmoothingEnabled = false

      // Ensure sub-pixel precision for thin lines
      this.ctx.lineJoin = "miter"
      this.ctx.lineCap = "square"
    }
  }

  /**
   * Render complete composite geometry (all layers)
   */
  renderComposite(
    geometry: CompositeGeometry,
    options: RenderOptions,
    getLayerStyle?: (layerId: number) => RenderStyle,
  ): void {
    if (!this.ctx) {
      throw new Error("Canvas context not available")
    }

    const startTime = performance.now()
    this.stats.primitivesRendered = 0
    this.stats.primitivesCulled = 0

    // Clear canvas with background color
    this.clear()

    // Setup viewport transform
    this.ctx.save()
    this.ctx.translate(
      options.transform.panOffset.x,
      options.transform.panOffset.y,
    )
    this.ctx.scale(options.transform.zoom, options.transform.zoom)

    // Render each layer in order (background to foreground)
    for (const layerGeometry of geometry.layers) {
      // Use layer-specific style if available, otherwise use base style
      const layerStyle = getLayerStyle
        ? getLayerStyle(layerGeometry.layer.id)
        : options.style

      this.renderLayerGeometry(
        layerGeometry.geometry,
        layerStyle,
        options.transform,
        // layerGeometry.layer.renderStyle,
      )
    }

    // Render subgrid overlay if enabled (while transforms are still active)
    if (SHOW_SUBGRID && geometry.layers.length > 0) {
      this.renderSubgridOverlay(
        options.transform,
        geometry.layers[0].geometry.gridSize,
      )
    }

    this.ctx.restore()

    this.stats.renderTime = performance.now() - startTime
    this.stats.lastFrameTime = performance.now()

    if (this.debugMode) {
      this.renderDebugInfo(options.transform)
    }
  }

  /**
   * Render a single layer's geometry
   */
  renderLayer(
    geometry: BlobGeometry,
    style: RenderStyle,
    transform: ViewportTransform,
  ): void {
    if (!this.ctx) return

    this.ctx.save()
    this.ctx.translate(transform.panOffset.x, transform.panOffset.y)
    this.ctx.scale(transform.zoom, transform.zoom)

    this.renderLayerGeometry(geometry, style, transform)

    this.ctx.restore()
  }

  /**
   * Render layer geometry with style
   */
  private renderLayerGeometry(
    geometry: BlobGeometry,
    baseStyle: RenderStyle,
    transform: ViewportTransform,
  ): void {
    if (!this.ctx || geometry.primitives.length === 0) return

    // Cull primitives outside viewport for performance
    const visiblePrimitives = RenderUtils.cullPrimitives(
      geometry.primitives,
      geometry.gridSize,
      transform,
    )

    this.stats.primitivesCulled +=
      geometry.primitives.length - visiblePrimitives.length

    // Batch primitives by type for better performance
    const rectangles: BlobPrimitive[] = []
    const roundedCorners: BlobPrimitive[] = []
    const bridges: BlobPrimitive[] = []

    for (const primitive of visiblePrimitives) {
      switch (primitive.type) {
        case "rectangle":
          rectangles.push(primitive)
          break
        case "roundedCorner":
          roundedCorners.push(primitive)
          break
        case "diagonalBridge":
          bridges.push(primitive)
          break
      }
    }

    // Render each type in batch
    this.renderRectangleBatch(rectangles, baseStyle, geometry.gridSize)
    this.renderRoundedCornerBatch(roundedCorners, baseStyle, geometry.gridSize)
    this.renderBridgeBatch(bridges, baseStyle, geometry.gridSize)

    this.stats.primitivesRendered += visiblePrimitives.length
  }

  /**
   * Render a batch of rectangle primitives
   */
  private renderRectangleBatch(
    primitives: BlobPrimitive[],
    style: RenderStyle,
    gridSize: number,
  ): void {
    if (!this.ctx || primitives.length === 0) return

    this.ctx.fillStyle = style.fillColor || "#000000"

    for (const primitive of primitives) {
      this.renderRectangle(primitive, gridSize)
    }
  }

  /**
   * Render a single rectangle primitive
   */
  private renderRectangle(primitive: BlobPrimitive, gridSize: number): void {
    if (!this.ctx) return

    const worldPos = this.gridToWorld(primitive.center, gridSize)

    this.ctx.save()
    this.ctx.translate(worldPos.x, worldPos.y)
    this.ctx.rotate(this.getQuadrantRotation(primitive.quadrant))

    // Expand primitive outward for border effect
    const size = primitive.size
    const borderExpansion = FEATHER_FACTOR
    this.ctx.fillRect(
      -borderExpansion,
      -borderExpansion,
      size + 2 * borderExpansion,
      size + 2 * borderExpansion,
    )

    this.ctx.restore()
  }

  /**
   * Render a batch of rounded corner primitives
   */
  private renderRoundedCornerBatch(
    primitives: BlobPrimitive[],
    style: RenderStyle,
    gridSize: number,
  ): void {
    if (!this.ctx || primitives.length === 0) return

    this.ctx.fillStyle = style.fillColor || "#000000"

    for (const primitive of primitives) {
      this.renderRoundedCorner(primitive, gridSize)
    }
  }

  /**
   * Render a single rounded corner primitive
   */
  private renderRoundedCorner(
    primitive: BlobPrimitive,
    gridSize: number,
  ): void {
    if (!this.ctx) return

    const worldPos = this.gridToWorld(primitive.center, gridSize)

    this.ctx.save()
    this.ctx.translate(worldPos.x, worldPos.y)
    this.ctx.rotate(this.getQuadrantRotation(primitive.quadrant))

    // Expand primitive outward for border effect
    const size = primitive.size
    const borderExpansion = FEATHER_FACTOR
    const expandedSize = size + borderExpansion
    const controlPoint = expandedSize * magicNr

    this.ctx.beginPath()
    this.ctx.moveTo(-borderExpansion, -borderExpansion)
    this.ctx.lineTo(expandedSize, -borderExpansion)
    this.ctx.bezierCurveTo(
      expandedSize,
      -borderExpansion + controlPoint,
      -borderExpansion + controlPoint,
      expandedSize,
      -borderExpansion,
      expandedSize,
    )
    this.ctx.closePath()

    this.ctx.fill()

    this.ctx.restore()
  }

  /**
   * Render a batch of bridge primitives
   */
  private renderBridgeBatch(
    primitives: BlobPrimitive[],
    style: RenderStyle,
    gridSize: number,
  ): void {
    if (!this.ctx || primitives.length === 0) return

    this.ctx.fillStyle = style.fillColor || "#000000"

    for (const primitive of primitives) {
      this.renderBridge(primitive, gridSize)
    }
  }

  /**
   * Render a single bridge primitive
   */
  private renderBridge(primitive: BlobPrimitive, gridSize: number): void {
    if (!this.ctx) return

    const worldPos = this.gridToWorld(primitive.center, gridSize)

    this.ctx.save()
    this.ctx.translate(worldPos.x, worldPos.y)
    this.ctx.rotate(this.getQuadrantRotation(primitive.quadrant))

    // Expand primitive outward for border effect
    const size = primitive.size
    const borderExpansion = FEATHER_FACTOR
    const expandedSize = size + borderExpansion
    const controlPoint = expandedSize * magicNr

    this.ctx.beginPath()
    this.ctx.moveTo(expandedSize, -borderExpansion)
    this.ctx.bezierCurveTo(
      expandedSize,
      -borderExpansion + controlPoint,
      -borderExpansion + controlPoint,
      expandedSize,
      -borderExpansion,
      expandedSize,
    )
    this.ctx.lineTo(expandedSize, expandedSize)
    this.ctx.closePath()

    this.ctx.fill()

    this.ctx.restore()
  }

  /**
   * Render a single primitive (for individual rendering)
   */
  renderPrimitive(
    primitive: BlobPrimitive,
    style: RenderStyle,
    transform: ViewportTransform,
  ): void {
    if (!this.ctx) return

    this.ctx.save()
    this.ctx.fillStyle = style.fillColor || "#000000"
    this.ctx.strokeStyle = style.strokeColor || "#000000"
    this.ctx.lineWidth = style.strokeWidth || 0

    switch (primitive.type) {
      case "rectangle":
        this.renderRectangle(primitive, 0) // gridSize 0 for direct rendering
        break
      case "roundedCorner":
        this.renderRoundedCorner(primitive, 0)
        break
      case "diagonalBridge":
        this.renderBridge(primitive, 0)
        break
    }

    this.ctx.restore()
  }

  /**
   * Clear the canvas
   */
  clear(): void {
    if (!this.ctx) return

    const canvas = this.ctx.canvas
    this.ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  /**
   * Get rotation angle for quadrant
   */
  private getQuadrantRotation(quadrant: 0 | 1 | 2 | 3): number {
    const rotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    return rotations[quadrant]
  }

  /**
   * Render debug information
   */
  private renderDebugInfo(transform: ViewportTransform): void {
    if (!this.ctx) return

    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0) // Reset transform for UI overlay

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)"
    this.ctx.fillRect(10, 10, 250, 100)

    this.ctx.fillStyle = "#ffffff"
    this.ctx.font = "12px monospace"
    this.ctx.fillText(`Rendered: ${this.stats.primitivesRendered}`, 20, 30)
    this.ctx.fillText(`Culled: ${this.stats.primitivesCulled}`, 20, 45)
    this.ctx.fillText(
      `Render time: ${this.stats.renderTime.toFixed(2)}ms`,
      20,
      60,
    )
    this.ctx.fillText(`Zoom: ${transform.zoom.toFixed(2)}x`, 20, 75)
    this.ctx.fillText(
      `Pan: ${transform.panOffset.x.toFixed(0)}, ${transform.panOffset.y.toFixed(0)}`,
      20,
      90,
    )

    this.ctx.restore()
  }

  /**
   * Get rendering statistics
   */
  getStats(): RenderStats & { debugMode: boolean } {
    return {
      ...this.stats,
      debugMode: this.debugMode,
    }
  }

  /**
   * Render debug subgrid overlay showing quadrant divisions
   */
  renderSubgridOverlay(viewport: ViewportTransform, gridSize: number): void {
    if (!this.ctx || !SHOW_SUBGRID) {
      return
    }

    this.ctx.save()

    // Calculate visible grid range in grid coordinates (not screen coordinates)
    // Since we're already in the transformed coordinate system, we need to work backwards
    const viewportMinX =
      Math.floor(-viewport.panOffset.x / (gridSize * viewport.zoom)) - 1
    const viewportMaxX =
      Math.ceil(
        (viewport.viewportWidth - viewport.panOffset.x) /
          (gridSize * viewport.zoom),
      ) + 1
    const viewportMinY =
      Math.floor(-viewport.panOffset.y / (gridSize * viewport.zoom)) - 1
    const viewportMaxY =
      Math.ceil(
        (viewport.viewportHeight - viewport.panOffset.y) /
          (gridSize * viewport.zoom),
      ) + 1

    // Set up line style for subgrid - scale with zoom for visibility
    this.ctx.strokeStyle = "rgba(255, 0, 0, 0.6)" // Semi-transparent red
    this.ctx.lineWidth = 1 / viewport.zoom // Scale line width inversely with zoom
    this.ctx.setLineDash([3 / viewport.zoom, 3 / viewport.zoom]) // Scale dash pattern

    this.ctx.beginPath()

    // Draw vertical quadrant lines (middle of each cell)
    for (let gridX = viewportMinX; gridX <= viewportMaxX; gridX++) {
      const worldX = gridX * gridSize + gridSize / 2 // Center of grid cell
      const startY = viewportMinY * gridSize
      const endY = (viewportMaxY + 1) * gridSize

      this.ctx.moveTo(worldX, startY)
      this.ctx.lineTo(worldX, endY)
    }

    // Draw horizontal quadrant lines (middle of each cell)
    for (let gridY = viewportMinY; gridY <= viewportMaxY; gridY++) {
      const worldY = gridY * gridSize + gridSize / 2 // Center of grid cell
      const startX = viewportMinX * gridSize
      const endX = (viewportMaxX + 1) * gridSize

      this.ctx.moveTo(startX, worldY)
      this.ctx.lineTo(endX, worldY)
    }

    this.ctx.stroke()

    // Draw grid cell boundaries (main grid)
    this.ctx.strokeStyle = "rgba(0, 0, 255, 0.4)" // Semi-transparent blue
    this.ctx.lineWidth = 1 / viewport.zoom // Scale line width inversely with zoom
    this.ctx.setLineDash([]) // Solid lines

    this.ctx.beginPath()

    // Vertical grid lines
    for (let gridX = viewportMinX; gridX <= viewportMaxX + 1; gridX++) {
      const worldX = gridX * gridSize
      const startY = viewportMinY * gridSize
      const endY = (viewportMaxY + 1) * gridSize

      this.ctx.moveTo(worldX, startY)
      this.ctx.lineTo(worldX, endY)
    }

    // Horizontal grid lines
    for (let gridY = viewportMinY; gridY <= viewportMaxY + 1; gridY++) {
      const worldY = gridY * gridSize
      const startX = viewportMinX * gridSize
      const endX = (viewportMaxX + 1) * gridSize

      this.ctx.moveTo(startX, worldY)
      this.ctx.lineTo(endX, worldY)
    }

    this.ctx.stroke()

    // Draw quadrant labels for debugging (only when reasonably zoomed in)
    if (viewport.zoom > 0.5) {
      // Show labels at lower zoom threshold
      this.ctx.fillStyle = "rgba(255, 100, 0, 0.9)"
      this.ctx.font = `${Math.max(8 / viewport.zoom, gridSize / 8)}px monospace`
      this.ctx.textAlign = "center"
      this.ctx.textBaseline = "middle"

      for (let gridX = viewportMinX; gridX <= viewportMaxX; gridX++) {
        for (let gridY = viewportMinY; gridY <= viewportMaxY; gridY++) {
          const centerX = gridX * gridSize + gridSize / 2
          const centerY = gridY * gridSize + gridSize / 2
          const quarterSize = gridSize / 4

          // Label each quadrant: 0=SE, 1=SW, 2=NW, 3=NE
          this.ctx.fillText("0", centerX + quarterSize, centerY + quarterSize) // SE
          this.ctx.fillText("1", centerX - quarterSize, centerY + quarterSize) // SW
          this.ctx.fillText("2", centerX - quarterSize, centerY - quarterSize) // NW
          this.ctx.fillText("3", centerX + quarterSize, centerY - quarterSize) // NE
        }
      }
    }

    this.ctx.restore()
  }

  /**
   * Set background color for clearing
   */
  setBackgroundColor(color: string): void {
    if (!this.ctx) return

    const canvas = this.ctx.canvas
    this.ctx.save()
    this.ctx.fillStyle = color
    this.ctx.fillRect(0, 0, canvas.width, canvas.height)
    this.ctx.restore()
  }
}
