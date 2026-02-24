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
  GridLayer,
  RenderStyle,
  GridPoint,
} from "../types"
import type { PointModifications } from "@/types/gridpaint"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"

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

    // Capture a non-null reference to the main context for the rest of this method
    const mainCtx: CanvasRenderingContext2D = this.ctx

    // Clear canvas with background color
    this.clear()

    // Setup viewport transform
    mainCtx.save()
    mainCtx.translate(
      options.transform.panOffset.x,
      options.transform.panOffset.y,
    )
    mainCtx.scale(options.transform.zoom, options.transform.zoom)

    // Render each layer in order (background to foreground).
    // NOTE: ideally layers with cutouts should be rendered onto an isolated
    // offscreen canvas so destination-out only punches holes in that layer and
    // not through layers already beneath it. Disabled for now — the DPR
    // pre-scale applied to the main canvas makes the coordinate mapping tricky.
    for (const layerGeometry of geometry.layers) {
      // Use layer-specific style if available, otherwise use base style
      const layerStyle = getLayerStyle
        ? getLayerStyle(layerGeometry.layer.id)
        : options.style

      this.renderLayerGeometry(
        layerGeometry.geometry,
        layerStyle,
        options.transform,
        layerGeometry.layer,
        options.mmPerUnit ?? 1,
      )
    }

    // Render subgrid overlay if enabled (while transforms are still active)
    if (SHOW_SUBGRID && geometry.layers.length > 0) {
      this.renderSubgridOverlay(
        options.transform,
        geometry.layers[0].geometry.gridSize,
      )
    }

    mainCtx.restore()

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
    layer?: GridLayer,
    mmPerUnit: number = 1,
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

    // If this layer has cutouts, establish a clipping region that excludes them
    // before painting any primitives. Using an even-odd clip (large rect covering
    // world space with the cutout circles subtracted) means the paint never
    // reaches those areas — no compositing tricks, no offscreen canvas needed.
    const hasCutouts =
      layer?.pointModifications && layer.pointModifications.size > 0
    if (hasCutouts) {
      this.ctx.save()
      this.applyCutoutClip(layer!.pointModifications!, geometry.gridSize, mmPerUnit)
    }

    // Render each type in batch
    this.renderRectangleBatch(rectangles, baseStyle, geometry.gridSize)
    this.renderRoundedCornerBatch(roundedCorners, baseStyle, geometry.gridSize)
    this.renderBridgeBatch(bridges, baseStyle, geometry.gridSize)

    if (hasCutouts) {
      this.ctx.restore()
    }

    this.stats.primitivesRendered += visiblePrimitives.length
  }

  /**
   * Apply an even-odd clipping region that excludes cutout circles.
   * Draws a large rect covering all world space, then subtracts each cutout
   * circle using the even-odd rule so those areas are clipped out.
   * Must be called inside a ctx.save()/ctx.restore() pair.
   */
  private applyCutoutClip(
    pointModifications: Map<string, PointModifications>,
    gridSize: number,
    mmPerUnit: number = 1,
  ): void {
    if (!this.ctx) return

    // A rect large enough to cover any reasonable canvas in world coordinates
    const BIG = 1e6

    this.ctx.beginPath()
    // Outer rect (clockwise) — this is the "paintable" area
    this.ctx.rect(-BIG, -BIG, BIG * 2, BIG * 2)

    // Each cutout circle (also clockwise in canvas default) — even-odd rule
    // means overlapping regions cancel, so circles become holes
    for (const [pointKey, mods] of pointModifications) {
      if (!mods.cutouts || mods.cutouts.length === 0) continue

      const [px, py] = pointKey.split(",").map(Number)

      for (const cutout of mods.cutouts) {
        const anchorOffset = cutout.anchor === "custom"
          ? (cutout.customOffset ?? { x: 0, y: 0 })
          : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
        const cx = (px + anchorOffset.x + (cutout.offset?.x ?? 0)) * gridSize + gridSize / 2
        const cy = (py + anchorOffset.y + (cutout.offset?.y ?? 0)) * gridSize + gridSize / 2
        const r = (cutout.diameterMm / 2 / mmPerUnit) * gridSize

        this.ctx.moveTo(cx + r, cy)
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
    }

    this.ctx.clip("evenodd")
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
   * Render a single rounded corner primitive.
   * If renderQuadrant is set and differs from quadrant, the curve is drawn
   * with a different orientation within the physical quadrant area.
   */
  private renderRoundedCorner(
    primitive: BlobPrimitive,
    gridSize: number,
  ): void {
    if (!this.ctx) return

    const worldPos = this.gridToWorld(primitive.center, gridSize)

    this.ctx.save()
    this.ctx.translate(worldPos.x, worldPos.y)
    // Always position at the physical quadrant
    this.ctx.rotate(this.getQuadrantRotation(primitive.quadrant))

    const size = primitive.size
    const b = FEATHER_FACTOR
    const s = size + b
    const cp = s * magicNr

    // Compute relative rotation steps between desired and physical direction
    const rq = primitive.renderQuadrant ?? primitive.quadrant
    const relOffset = ((rq - primitive.quadrant) % 4 + 4) % 4

    // Each offset replaces a different corner of the quadrant square with a curve.
    // The curve bulges toward that corner; the two edges adjacent to the opposite
    // corner remain straight.
    //   offset 0 (SE): corner at (-b,-b), curve replaces (s,s) corner
    //   offset 1 (SW): corner at (s,-b),  curve replaces (-b,s) corner
    //   offset 2 (NW): corner at (s,s),   curve replaces (-b,-b) corner
    //   offset 3 (NE): corner at (-b,s),  curve replaces (s,-b) corner
    this.ctx.beginPath()
    if (relOffset === 0) {
      this.ctx.moveTo(-b, -b)
      this.ctx.lineTo(s, -b)
      this.ctx.bezierCurveTo(s, -b + cp, -b + cp, s, -b, s)
      this.ctx.closePath()
    } else if (relOffset === 1) {
      this.ctx.moveTo(s, -b)
      this.ctx.lineTo(-b, -b)
      this.ctx.bezierCurveTo(-b, -b + cp, s - cp, s, s, s)
      this.ctx.closePath()
    } else if (relOffset === 2) {
      this.ctx.moveTo(s, s)
      this.ctx.lineTo(-b, s)
      this.ctx.bezierCurveTo(-b, s - cp, s - cp, -b, s, -b)
      this.ctx.closePath()
    } else {
      this.ctx.moveTo(-b, s)
      this.ctx.lineTo(s, s)
      this.ctx.bezierCurveTo(s, s - cp, -b + cp, -b, -b, -b)
      this.ctx.closePath()
    }

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
   * Render a single bridge primitive.
   * If renderQuadrant differs from quadrant, the concave curve is oriented
   * differently within the physical quadrant area.
   */
  private renderBridge(primitive: BlobPrimitive, gridSize: number): void {
    if (!this.ctx) return

    const worldPos = this.gridToWorld(primitive.center, gridSize)

    this.ctx.save()
    this.ctx.translate(worldPos.x, worldPos.y)
    // Always position at the physical quadrant
    this.ctx.rotate(this.getQuadrantRotation(primitive.quadrant))

    const size = primitive.size
    const b = FEATHER_FACTOR
    const s = size + b
    const cp = s * magicNr

    // Compute relative rotation steps between desired and physical direction
    const rq = primitive.renderQuadrant ?? primitive.quadrant
    const relOffset = ((rq - primitive.quadrant) % 4 + 4) % 4

    // A bridge fills the triangular area between the curve and the corner it
    // bulges toward. Same curve as roundedCorner but the filled region is
    // on the opposite side.
    //   offset 0 (SE): curve (s,-b)→(-b,s) bulging SE, fill triangle at (s,s)
    //   offset 1 (SW): curve (-b,-b)→(s,s) bulging SW, fill triangle at (-b,s)
    //   offset 2 (NW): curve (-b,s)→(s,-b) bulging NW, fill triangle at (-b,-b)
    //   offset 3 (NE): curve (s,s)→(-b,-b) bulging NE, fill triangle at (s,-b)
    this.ctx.beginPath()
    if (relOffset === 0) {
      this.ctx.moveTo(s, -b)
      this.ctx.bezierCurveTo(s, -b + cp, -b + cp, s, -b, s)
      this.ctx.lineTo(s, s)
      this.ctx.closePath()
    } else if (relOffset === 1) {
      this.ctx.moveTo(-b, -b)
      this.ctx.bezierCurveTo(-b, -b + cp, s - cp, s, s, s)
      this.ctx.lineTo(-b, s)
      this.ctx.closePath()
    } else if (relOffset === 2) {
      this.ctx.moveTo(-b, s)
      this.ctx.bezierCurveTo(-b, s - cp, s - cp, -b, s, -b)
      this.ctx.lineTo(-b, -b)
      this.ctx.closePath()
    } else {
      this.ctx.moveTo(s, s)
      this.ctx.bezierCurveTo(s, s - cp, -b + cp, -b, -b, -b)
      this.ctx.lineTo(s, -b)
      this.ctx.closePath()
    }

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
