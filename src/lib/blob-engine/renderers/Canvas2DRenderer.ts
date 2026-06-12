/**
 * Canvas2DRenderer - High-performance Canvas 2D blob renderer
 *
 * Rendering model (first principles):
 *
 * - Every primitive of a layer is appended into Path2D objects (world
 *   coordinates, exact 90°-rotation math — see primitivePaths.ts) and the
 *   layer is painted with ONE nonzero-winding fill. A single fill rasterizes
 *   coincident subpath edges together, so abutting quadrant shapes produce no
 *   antialiasing seams and need no outward "feather" expansion. With no
 *   feather, quarter circles are exactly tangent to the straight edges they
 *   continue (no corner points at the start of slopes).
 *
 * - Paths are cached per BlobGeometry identity in cell-aligned tiles
 *   (TILE_CELLS × TILE_CELLS grid cells per tile). Pan/zoom never rebuilds
 *   geometry or paths: each frame merges the tiles intersecting the viewport
 *   (cached until the visible tile set changes) and issues one fill per
 *   layer. Frame cost is therefore bounded by visible content, not by
 *   drawing size.
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  CompositeGeometry,
  GridLayer,
  RenderStyle,
} from "../types"
import type { PointModifications } from "@/types/gridpaint"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"

import {
  Renderer,
  type ViewportTransform,
  type RenderOptions,
} from "./Renderer"
import { appendPrimitivePath } from "./primitivePaths"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"

// Debug visualization constants
const SHOW_SUBGRID = false // Set to true to show quadrant grid lines

/** Grid cells per cached path tile (matches GeometryCache region size) */
const TILE_CELLS = 16

interface PathTile {
  path: Path2D
  primitiveCount: number
  tileX: number
  tileY: number
}

interface LayerPathCache {
  tiles: Map<string, PathTile>
  /** Union of all tiles — used when everything is visible */
  fullPath: Path2D
  totalPrimitives: number
  /** Cache of the last merged visible-tile path */
  mergedKey: string | null
  mergedPath: Path2D | null
  mergedCount: number
}

interface RenderStats {
  primitivesRendered: number
  primitivesCulled: number
  renderTime: number
  lastFrameTime: number
}

export class Canvas2DRenderer extends Renderer {
  private ctx: CanvasRenderingContext2D | null = null
  /**
   * Path caches keyed by BlobGeometry object identity. Geometry objects are
   * stable across pan/zoom (and, with per-layer geometry caching in the
   * canvas component, across edits of other layers), so paths are only
   * rebuilt when a layer's geometry actually changes.
   */
  private pathCaches = new WeakMap<BlobGeometry, LayerPathCache>()
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
      // Crisp rendering for image overlays drawn through this context
      this.ctx.imageSmoothingEnabled = false
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

      const scaleFactor = scaleToFactor(layerGeometry.layer.scale)
      if (scaleFactor !== 1) {
        mainCtx.save()
        mainCtx.scale(scaleFactor, scaleFactor)
      }

      this.renderLayerGeometry(
        layerGeometry.geometry,
        layerStyle,
        options.transform,
        layerGeometry.layer,
        options.mmPerUnit ?? 1,
        scaleFactor,
      )

      if (scaleFactor !== 1) {
        mainCtx.restore()
      }
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
   * Render layer geometry with a single fill of the cached, viewport-merged path
   */
  private renderLayerGeometry(
    geometry: BlobGeometry,
    style: RenderStyle,
    transform: ViewportTransform,
    layer?: GridLayer,
    mmPerUnit: number = 1,
    scaleFactor: number = 1,
  ): void {
    if (!this.ctx || geometry.primitives.length === 0) return

    const cache = this.getLayerPathCache(geometry)
    const visible = this.getVisiblePath(cache, geometry, transform, scaleFactor)

    this.stats.primitivesCulled += cache.totalPrimitives - visible.count
    if (visible.count === 0 || !visible.path) return

    // If this layer has cutouts, establish a clipping region that excludes them
    // before painting. Using an even-odd clip (large rect covering world space
    // with the cutout circles subtracted) means the paint never reaches those
    // areas — no compositing tricks, no offscreen canvas needed.
    const hasCutouts =
      layer?.pointModifications && layer.pointModifications.size > 0
    if (hasCutouts) {
      this.ctx.save()
      this.applyCutoutClip(
        layer!.pointModifications!,
        geometry.gridSize,
        mmPerUnit,
      )
    }

    this.ctx.fillStyle = style.fillColor || "#000000"
    this.ctx.fill(visible.path)

    if (hasCutouts) {
      this.ctx.restore()
    }

    this.stats.primitivesRendered += visible.count
  }

  /**
   * Get (or build) the tiled path cache for a geometry object
   */
  private getLayerPathCache(geometry: BlobGeometry): LayerPathCache {
    let cache = this.pathCaches.get(geometry)
    if (!cache) {
      cache = this.buildLayerPathCache(geometry)
      this.pathCaches.set(geometry, cache)
    }
    return cache
  }

  private buildLayerPathCache(geometry: BlobGeometry): LayerPathCache {
    const tiles = new Map<string, PathTile>()

    for (const primitive of geometry.primitives) {
      const tileX = Math.floor(primitive.center.x / TILE_CELLS)
      const tileY = Math.floor(primitive.center.y / TILE_CELLS)
      const key = `${tileX},${tileY}`

      let tile = tiles.get(key)
      if (!tile) {
        tile = { path: new Path2D(), primitiveCount: 0, tileX, tileY }
        tiles.set(key, tile)
      }

      appendPrimitivePath(tile.path, primitive, geometry.gridSize)
      tile.primitiveCount++
    }

    const fullPath = new Path2D()
    for (const tile of tiles.values()) {
      fullPath.addPath(tile.path)
    }

    return {
      tiles,
      fullPath,
      totalPrimitives: geometry.primitives.length,
      mergedKey: null,
      mergedPath: null,
      mergedCount: 0,
    }
  }

  /**
   * Select the cached path covering the current viewport: the full path when
   * everything is visible, otherwise a merged path of the visible tiles
   * (cached until the visible tile set changes).
   */
  private getVisiblePath(
    cache: LayerPathCache,
    geometry: BlobGeometry,
    transform: ViewportTransform,
    scaleFactor: number,
  ): { path: Path2D | null; count: number } {
    const { zoom, panOffset, viewportWidth, viewportHeight } = transform
    const worldScale = zoom * scaleFactor

    if (
      !isFinite(viewportWidth) ||
      !isFinite(viewportHeight) ||
      !(worldScale > 0)
    ) {
      // Without a usable viewport, render everything
      return { path: cache.fullPath, count: cache.totalPrimitives }
    }

    // Visible range in cell coordinates (+1 cell padding: a primitive extends
    // up to one cell beyond its center coordinate)
    const minCellX = Math.floor(-panOffset.x / worldScale / geometry.gridSize) - 1
    const maxCellX =
      Math.ceil((viewportWidth - panOffset.x) / worldScale / geometry.gridSize) + 1
    const minCellY = Math.floor(-panOffset.y / worldScale / geometry.gridSize) - 1
    const maxCellY =
      Math.ceil((viewportHeight - panOffset.y) / worldScale / geometry.gridSize) + 1

    const minTileX = Math.floor(minCellX / TILE_CELLS)
    const maxTileX = Math.floor(maxCellX / TILE_CELLS)
    const minTileY = Math.floor(minCellY / TILE_CELLS)
    const maxTileY = Math.floor(maxCellY / TILE_CELLS)

    const visibleTiles: PathTile[] = []
    const keyParts: string[] = []
    for (const [key, tile] of cache.tiles) {
      if (
        tile.tileX >= minTileX &&
        tile.tileX <= maxTileX &&
        tile.tileY >= minTileY &&
        tile.tileY <= maxTileY
      ) {
        visibleTiles.push(tile)
        keyParts.push(key)
      }
    }

    if (visibleTiles.length === cache.tiles.size) {
      return { path: cache.fullPath, count: cache.totalPrimitives }
    }
    if (visibleTiles.length === 0) {
      return { path: null, count: 0 }
    }

    const mergedKey = keyParts.join(";")
    if (cache.mergedKey !== mergedKey) {
      const merged = new Path2D()
      let count = 0
      for (const tile of visibleTiles) {
        merged.addPath(tile.path)
        count += tile.primitiveCount
      }
      cache.mergedKey = mergedKey
      cache.mergedPath = merged
      cache.mergedCount = count
    }

    return { path: cache.mergedPath, count: cache.mergedCount }
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
   * Render a single primitive (for individual rendering)
   */
  renderPrimitive(primitive: BlobPrimitive, style: RenderStyle): void {
    if (!this.ctx) return

    this.ctx.save()
    this.ctx.fillStyle = style.fillColor || "#000000"

    // gridSize 0 places the primitive's cell origin at (0,0) for direct rendering
    const path = new Path2D()
    appendPrimitivePath(path, primitive, 0)
    this.ctx.fill(path)

    this.ctx.restore()
  }

  /**
   * Clear the canvas
   */
  clear(): void {
    if (!this.ctx) return

    const canvas = this.ctx.canvas
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.ctx.restore()
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
