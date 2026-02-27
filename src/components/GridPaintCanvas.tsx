import {
  useMemo,
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react"
import { useStore } from "@nanostores/react"
import type { Tool } from "@/stores/ui"
import {
  $currentTool,
  $activeGroupIndex,
  $cutoutToolSettings,
  $overrideToolSettings,
  $measureState,
  $selectionState,
  setActiveGroupIndex,
} from "@/stores/ui"
import { useSelection } from "@/hooks/useSelection"
import { useSelectionRenderer } from "@/hooks/useSelectionRenderer"
import { useExportRects } from "@/hooks/useExportRects"
import { renderExportRects } from "@/lib/gridpaint/renderExportRects"
import { ExportRectOverlay } from "@/components/ExportRectOverlay"

// New blob engine imports
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { Canvas2DRenderer } from "@/lib/blob-engine/renderers/Canvas2DRenderer"
import type {
  GridLayer as BlobGridLayer,
  SpatialRegion,
} from "@/lib/blob-engine/types"

// Existing imports for compatibility
import { drawActiveLayerOutline } from "@/lib/gridpaint/drawActiveOutline"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import { showActiveLayerOutline } from "@/stores/ui"
import useDrawingState from "@/hooks/useDrawingState"
import {
  exportDrawingAsJSON,
  exportAllLayersAsSVG,
} from "@/lib/export/exportUtils"
import { pushHistory } from "@/stores/historyStore"
import {
  type Layer,
  getLayerPoints,
  $canvasView,
  $layersState,
  $drawingMeta,
  $exportRects,
  addLayer,
  setActiveLayer,
  toggleLayerVisibility,
  toggleLayerRenderStyle,
  createOrActivateLayer,
  updateLayerPoints,
  updateGroupPoints,
  updatePointModifications,
  clearPointModifications,
  addGroupToActiveLayer,
  resetDrawing,
} from "@/stores/drawingStores"
import type { CircularCutout, PointModifications } from "@/types/gridpaint"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"

// Theme color utility
const getCanvasColor = (varName: string): string => {
  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return hslValue ? `hsl(${hslValue})` : "#000000"
}

interface GridPaintCanvasProps {
  currentTool?: Tool // deprecated: now uses $currentTool store
  drawingId: string
}

export interface GridPaintCanvasMethods {
  reset: () => void
  setGridSize: (operation: "+" | "-") => void
  setBorderWidth: (width: number) => void
  setMmPerUnit: (mmPerUnit: number) => void
  saveIMG: () => void
  setActiveLayer: (layerId: number | null) => void
  toggleLayerVisibility: (layerId: number) => void
  createNewLayer: () => boolean
  deleteLayer: (layerId: number) => void
  toggleLayerRenderStyle: (layerId: number) => void
  getLayerState: () => { layers: Layer[]; activeLayerId: number | null }
  setPanOffset: (x: number, y: number) => void
  centerCanvas: () => void
  zoomIn: () => void
  zoomOut: () => void
  setName: (name: string) => void
  createOrActivateLayer: (layerId: number) => void
}

export const GridPaintCanvas = forwardRef<
  GridPaintCanvasMethods,
  GridPaintCanvasProps
>(({ drawingId }, ref) => {
  const currentTool = useStore($currentTool)
  const activeGroupIndex = useStore($activeGroupIndex)
  const cutoutSettings = useStore($cutoutToolSettings)
  const overrideSettings = useStore($overrideToolSettings)
  const $showActiveLayerOutline = useStore(showActiveLayerOutline)
  const canvasView = useStore($canvasView)
  const {
    zoom: canvasZoom,
    panOffset: canvasPanOffset,
    gridSize: canvasGridSize,
  } = canvasView
  const layersState = useStore($layersState)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { drawingMeta, isReady } = useDrawingState(drawingId)

  // New blob engine instances
  const [blobEngine] = useState(
    () => new BlobEngine({ enableCaching: true, debugMode: false }),
  )
  const [renderer, setRenderer] = useState<Canvas2DRenderer | null>(null)

  // Interaction state
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [lastPaintCoords, setLastPaintCoords] = useState<{
    x: number
    y: number
  } | null>(null)

  /** Last known mouse position in client coordinates (used for cursor-position paste) */
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  /**
   * Drag-to-move: the grid cell where the current move-drag gesture started.
   * Stored in a ref so mouse-move handlers always read the latest value without
   * triggering re-renders or stale-closure issues.
   */
  const moveDragStartRef = useRef<{ x: number; y: number } | null>(null)

  /** Tracks the cutout currently under the cursor (cutout tool only) */
  const hoveredCutoutRef = useRef<{
    pointKey: string
    index: number
    cx: number
    cy: number
    r: number
    cutout: CircularCutout
  } | null>(null)

  // Selection hooks
  const selection = useSelection()
  const { renderSelectionRectangle, renderFloatingPaste } = useSelectionRenderer()
  const selectionState = useStore($selectionState)

  // Export rect hooks
  const exportRectsHook = useExportRects()
  const exportRects = useStore($exportRects)

  const [didInitialize, setDidInitialize] = useState(false)

  // Initialize canvas and renderer
  const initializeCanvas = useCallback(
    (didResize = false) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (didInitialize && !didResize) return

      setDidInitialize(true)

      const pixelRatio = window.devicePixelRatio || 1
      const displayWidth = window.innerWidth
      const displayHeight = window.innerHeight

      canvas.width = displayWidth * pixelRatio
      canvas.height = displayHeight * pixelRatio
      canvas.style.width = displayWidth + "px"
      canvas.style.height = displayHeight + "px"

      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.scale(pixelRatio, pixelRatio)
      }

      // Initialize renderer
      const newRenderer = new Canvas2DRenderer(canvas, false)
      setRenderer(newRenderer)
    },
    [didInitialize],
  )

  // Convert store layers to blob engine format
  const convertLayersToBlobFormat = useCallback(
    (layers: Layer[]): BlobGridLayer[] => {
      return layers.map((layer) => ({
        id: layer.id,
        groups: layer.groups.map((g) => ({
          id: g.id,
          name: g.name,
          points: new Set(g.points),
        })),
        isVisible: layer.isVisible,
        renderStyle: layer.renderStyle,
        pointModifications: layer.pointModifications,
      }))
    },
    [],
  )

  // Helper: expand a viewport by N grid cells
  const expandViewport = useCallback(
    (vp: SpatialRegion, pad: number): SpatialRegion => ({
      minX: vp.minX - pad,
      minY: vp.minY - pad,
      maxX: vp.maxX + pad,
      maxY: vp.maxY + pad,
    }),
    [],
  )

  const calculateCurrentViewport = useCallback((): SpatialRegion => {
    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight

    const viewportMinX =
      Math.floor(-canvasPanOffset.x / (canvasGridSize * canvasZoom)) - 2
    const viewportMaxX =
      Math.ceil(
        (displayWidth - canvasPanOffset.x) / (canvasGridSize * canvasZoom),
      ) + 2
    const viewportMinY =
      Math.floor(-canvasPanOffset.y / (canvasGridSize * canvasZoom)) - 2
    const viewportMaxY =
      Math.ceil(
        (displayHeight - canvasPanOffset.y) / (canvasGridSize * canvasZoom),
      ) + 2

    return {
      minX: viewportMinX,
      minY: viewportMinY,
      maxX: viewportMaxX,
      maxY: viewportMaxY,
    }
  }, [canvasZoom, canvasPanOffset, canvasGridSize])

  // Cache geometry generation - only regenerate when layers or settings change.
  // Zoom/pan do not trigger geometry regeneration; they are pure canvas transforms
  // applied at render time on top of already-cached geometry.
  const cachedGeometry = useMemo(() => {
    if (!isReady) return null

    console.log("Regenerating cached geometry - layers changed")

    // Convert layers to blob format
    const blobLayers = convertLayersToBlobFormat(layersState.layers)

    // Generate geometry for all points (no viewport culling here — zoom/pan must
    // not invalidate this cache, and typical drawings are small enough that full
    // computation is fast).
    return blobEngine.generateGeometry(
      blobLayers,
      canvasView.gridSize,
      canvasView.borderWidth,
    )
  }, [
    isReady,
    blobEngine,
    convertLayersToBlobFormat,
    layersState.layers,
    canvasView.gridSize,
    canvasView.borderWidth,
  ])

  const getGridCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left - canvasView.panOffset.x) / canvasView.zoom
      const y = (clientY - rect.top - canvasView.panOffset.y) / canvasView.zoom

      const gridX = Math.floor(x / canvasView.gridSize)
      const gridY = Math.floor(y / canvasView.gridSize)

      return { x: gridX, y: gridY }
    },
    [canvasView],
  )

  /**
   * Get sub-grid coordinates: which quadrant of which cell the cursor is in.
   * Quadrant indices: 0=SE (+x,+y), 1=SW (-x,+y), 2=NW (-x,-y), 3=NE (+x,-y)
   */
  const getQuadrantCoordinates = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { gridX: number; gridY: number; quadrant: 0 | 1 | 2 | 3 } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left - canvasView.panOffset.x) / canvasView.zoom
      const y = (clientY - rect.top - canvasView.panOffset.y) / canvasView.zoom

      const gridX = Math.floor(x / canvasView.gridSize)
      const gridY = Math.floor(y / canvasView.gridSize)

      // Position within the cell (0..1)
      const cellX = x / canvasView.gridSize - gridX
      const cellY = y / canvasView.gridSize - gridY

      // Determine quadrant: right half = E, left half = W; bottom half = S, top half = N
      // Quadrant mapping: 0=SE, 1=SW, 2=NW, 3=NE
      let quadrant: 0 | 1 | 2 | 3
      if (cellX >= 0.5) {
        quadrant = cellY >= 0.5 ? 0 : 3 // right: SE or NE
      } else {
        quadrant = cellY >= 0.5 ? 1 : 2 // left: SW or NW
      }

      return { gridX, gridY, quadrant }
    },
    [canvasView],
  )

  /**
   * Given a screen-space mouse position, find the smallest cutout (across all points
   * on the active layer) whose circle contains that position.
   * Returns world-space circle center + radius so the render overlay can use it directly.
   */
  const getHoveredCutout = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      // World-space mouse coords (after removing pan+zoom)
      const wx =
        (clientX - rect.left - canvasView.panOffset.x) / canvasView.zoom
      const wy = (clientY - rect.top - canvasView.panOffset.y) / canvasView.zoom

      const { activeLayerId, layers } = $layersState.get()
      if (activeLayerId === null) return null
      const activeLayer = layers.find((l) => l.id === activeLayerId)
      if (!activeLayer?.pointModifications) return null

      let best: {
        pointKey: string
        index: number
        cx: number
        cy: number
        r: number
        cutout: CircularCutout
      } | null = null

      for (const [pointKey, mods] of activeLayer.pointModifications) {
        if (!mods.cutouts || mods.cutouts.length === 0) continue
        const [px, py] = pointKey.split(",").map(Number)

        mods.cutouts.forEach((cutout, index) => {
          const anchorOffset =
            cutout.anchor === "custom"
              ? (cutout.customOffset ?? { x: 0, y: 0 })
              : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
          const cx =
            (px + anchorOffset.x + (cutout.offset?.x ?? 0)) *
              canvasView.gridSize +
            canvasView.gridSize / 2
          const cy =
            (py + anchorOffset.y + (cutout.offset?.y ?? 0)) *
              canvasView.gridSize +
            canvasView.gridSize / 2
          const r =
            (cutout.diameterMm / 2 / canvasView.mmPerUnit) * canvasView.gridSize

          const dist = Math.sqrt((wx - cx) ** 2 + (wy - cy) ** 2)
          if (dist <= r) {
            // Prefer the smallest circle that contains the cursor
            if (!best || r < best.r) {
              best = { pointKey, index, cx, cy, r, cutout }
            }
          }
        })
      }

      return best as {
        pointKey: string
        index: number
        cx: number
        cy: number
        r: number
        cutout: CircularCutout
      } | null
    },
    [canvasView],
  )

  /** Handle cutout tool click: add cutout to a point, or alt+click-on-cutout to remove it */
  const handleCutoutClick = useCallback(
    (clientX: number, clientY: number, isAltHeld: boolean) => {
      if (isAltHeld) {
        // Alt+click: only remove the specific hovered cutout; do nothing if none hovered
        const hovered = hoveredCutoutRef.current
        if (!hovered) return

        const currentLayersState = $layersState.get()
        const { activeLayerId, layers } = currentLayersState
        if (activeLayerId === null) return
        const activeLayer = layers.find((l) => l.id === activeLayerId)
        if (!activeLayer) return

        const existingMods = activeLayer.pointModifications?.get(
          hovered.pointKey,
        )
        if (!existingMods?.cutouts) return

        const newCutouts = existingMods.cutouts.filter(
          (_, i) => i !== hovered.index,
        )
        const newMods: PointModifications = { ...existingMods }
        if (newCutouts.length > 0) {
          newMods.cutouts = newCutouts
        } else {
          delete newMods.cutouts
        }
        const hasAnything =
          newMods.cutouts ||
          (newMods.quadrantOverrides &&
            Object.keys(newMods.quadrantOverrides).length > 0)
        updatePointModifications(
          activeLayerId,
          hovered.pointKey,
          hasAnything ? newMods : undefined,
        )

        // Clear hover state since we just removed the cutout
        hoveredCutoutRef.current = null

        const [hx, hy] = hovered.pointKey.split(",").map(Number)
        blobEngine.invalidateLayer(activeLayerId, {
          minX: hx - 1,
          minY: hy - 1,
          maxX: hx + 1,
          maxY: hy + 1,
        })
        return
      }

      const coords = getGridCoordinates(clientX, clientY)
      if (!coords) return

      const currentLayersState = $layersState.get()
      const { activeLayerId, layers } = currentLayersState
      if (activeLayerId === null) return

      const activeLayer = layers.find((l) => l.id === activeLayerId)
      if (!activeLayer) return

      const pointKey = `${coords.x},${coords.y}`

      // Only allow cutouts on existing points
      const allPoints = getLayerPoints(activeLayer)
      if (!allPoints.has(pointKey)) return

      const existingMods = activeLayer.pointModifications?.get(pointKey)

      // Add a cutout with current settings (store diameterMm as primary value;
      // renderers convert to grid units at draw time using mmPerUnit)
      const { anchor, diameterMm, customOffset } = cutoutSettings

      const newCutout: CircularCutout = {
        anchor,
        diameterMm,
        ...(anchor === "custom" ? { customOffset } : {}),
      }

      const existingCutouts = existingMods?.cutouts || []
      const newMods: PointModifications = {
        ...existingMods,
        cutouts: [...existingCutouts, newCutout],
      }
      updatePointModifications(activeLayerId, pointKey, newMods)

      // Invalidate cache
      blobEngine.invalidateLayer(activeLayerId, {
        minX: coords.x - 1,
        minY: coords.y - 1,
        maxX: coords.x + 1,
        maxY: coords.y + 1,
      })
    },
    [getGridCoordinates, cutoutSettings, blobEngine],
  )

  /** Handle override tool click: set quadrant override, or alt+click to clear */
  const handleOverrideClick = useCallback(
    (clientX: number, clientY: number, isAltHeld: boolean) => {
      const qCoords = getQuadrantCoordinates(clientX, clientY)
      if (!qCoords) return

      const currentLayersState = $layersState.get()
      const { activeLayerId, layers } = currentLayersState
      if (activeLayerId === null) return

      const activeLayer = layers.find((l) => l.id === activeLayerId)
      if (!activeLayer) return

      const pointKey = `${qCoords.gridX},${qCoords.gridY}`

      if (isAltHeld) {
        // Clear override on this specific quadrant (works for both group points and override-only points)
        const existingMods = activeLayer.pointModifications?.get(pointKey)
        if (!existingMods) return
        if (existingMods?.quadrantOverrides) {
          const newOverrides = { ...existingMods.quadrantOverrides }
          delete newOverrides[qCoords.quadrant]
          const hasOverrides = Object.keys(newOverrides).length > 0
          const newMods: PointModifications = {
            ...existingMods,
            quadrantOverrides: hasOverrides ? newOverrides : undefined,
          }
          const hasAnything = newMods.cutouts || newMods.quadrantOverrides
          updatePointModifications(
            activeLayerId,
            pointKey,
            hasAnything ? newMods : undefined,
          )
        }
      } else {
        // Apply the selected shape to this quadrant (no need to create a layer point first)
        const { shape } = overrideSettings
        const existingMods = activeLayer.pointModifications?.get(pointKey)
        const existingOverrides = existingMods?.quadrantOverrides || {}
        const newMods: PointModifications = {
          ...existingMods,
          quadrantOverrides: {
            ...existingOverrides,
            [qCoords.quadrant]: shape,
          },
        }
        updatePointModifications(activeLayerId, pointKey, newMods)
      }

      // Invalidate cache
      blobEngine.invalidateLayer(activeLayerId, {
        minX: qCoords.gridX - 1,
        minY: qCoords.gridY - 1,
        maxX: qCoords.gridX + 1,
        maxY: qCoords.gridY + 1,
      })
    },
    [getQuadrantCoordinates, overrideSettings, blobEngine],
  )

  // Main render function - now just handles transforms and rendering
  const render = useCallback(() => {
    if (!renderer || !isReady || !cachedGeometry) return

    const startTime = performance.now()

    // Rendering with transforms only - fast path

    // Use the cached geometry with current transform
    const transform = {
      zoom: canvasView.zoom,
      panOffset: canvasView.panOffset,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }

    const baseStyle = {
      fillColor: "#000000", // Will be overridden per layer
      strokeColor: getCanvasColor("--canvas-layer-border"),
      strokeWidth: canvasView.borderWidth,
      opacity: 1,
    }

    // Create a function to get layer-specific styles
    const getLayerStyle = (layerId: number) => {
      const layer = layersState.layers.find((l) => l.id === layerId)
      if (!layer) return baseStyle

      return {
        fillColor: getCanvasColor(`--canvas-layer-${layerId}`),
        strokeColor:
          layer.renderStyle === "tiles"
            ? getCanvasColor("--canvas-layer-border")
            : undefined,
        strokeWidth: layer.renderStyle === "tiles" ? canvasView.borderWidth : 0,
        opacity: 1,
      }
    }

    // Render the cached geometry with current transforms
    renderer.renderComposite(
      cachedGeometry,
      { style: baseStyle, transform, mmPerUnit: canvasView.mmPerUnit },
      getLayerStyle,
    )

    // Render active layer outline if enabled (only for active group)
    if ($showActiveLayerOutline && layersState.activeLayerId !== null) {
      const activeLayer = layersState.layers.find(
        (l) => l.id === layersState.activeLayerId,
      )
      if (activeLayer && activeLayer.isVisible) {
        renderActiveLayerOutlineCompat(activeLayer)
      }
    }

    // Render selection rectangle if active
    if (currentTool === "select" && selection.hasSelection && renderer) {
      renderSelectionRectangle(
        renderer,
        selection.selectionStart!,
        selection.selectionEnd!,
        canvasView,
      )
    }

    // Render export rects when export tool is active
    if (currentTool === "export" && renderer?.context) {
      renderExportRects(
        renderer.context,
        exportRects,
        exportRectsHook.draftBounds,
        canvasView,
      )
    }

    // Render floating paste overlay if active
    if (selectionState.floatingPaste && renderer) {
      renderFloatingPaste(renderer, selectionState.floatingPaste, canvasView)
    }

    // Render cutout hover overlay: border ring + label for the hovered cutout
    if (
      currentTool === "cutout" &&
      hoveredCutoutRef.current &&
      renderer?.context
    ) {
      const ctx = renderer.context
      const { cx, cy, r, cutout } = hoveredCutoutRef.current
      const highlightColor = getCanvasColor("--highlighted")

      ctx.save()
      ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
      ctx.scale(canvasView.zoom, canvasView.zoom)

      // Stroke the circle border
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = highlightColor
      ctx.lineWidth = 1.5 / canvasView.zoom
      ctx.stroke()

      // Draw label: "anchor · Xmm" just above the circle
      const anchorLabel = cutout.anchor === "custom" ? "custom" : cutout.anchor
      const label = `${anchorLabel} · ${cutout.diameterMm}mm`
      // 11px fixed screen-space font (divide by zoom since we're inside the scaled ctx)
      const fontSize = 11 / canvasView.zoom
      ctx.font = `${fontSize}px monospace`
      ctx.fillStyle = highlightColor
      ctx.textAlign = "center"
      ctx.textBaseline = "bottom"
      // Small backdrop for legibility
      const textMetrics = ctx.measureText(label)
      const textW = textMetrics.width
      const textH = fontSize
      const labelY = cy - r - 4 / canvasView.zoom
      ctx.globalAlpha = 0.75
      ctx.fillStyle = getCanvasColor("--background")
      ctx.fillRect(cx - textW / 2 - 3, labelY - textH - 2, textW + 6, textH + 4)
      ctx.globalAlpha = 1
      ctx.fillStyle = highlightColor
      ctx.fillText(label, cx, labelY)

      ctx.restore()
    }

    const renderTime = performance.now() - startTime
    if (renderTime > 16) {
      // Log slow frames
      console.log(`Render took ${renderTime.toFixed(2)}ms`)
    }
  }, [
    renderer,
    isReady,
    cachedGeometry,
    canvasView,
    layersState,
    $showActiveLayerOutline,
    activeGroupIndex,
    currentTool,
    selection.hasSelection,
    selection.selectionStart,
    selection.selectionEnd,
    renderSelectionRectangle,
    selectionState.floatingPaste,
    renderFloatingPaste,
    exportRects,
    exportRectsHook.draftBounds,
  ])

  // Center canvas to fit all visible content
  const centerCanvasToContent = useCallback(() => {
    // Calculate bounds from all visible layers (fresh read)
    const state = $layersState.get()
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    let hasPoints = false

    state.layers.forEach((layer) => {
      if (!layer.isVisible) return
      for (const pointKey of getLayerPoints(layer)) {
        const [x, y] = pointKey.split(",").map(Number)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        hasPoints = true
      }
    })

    if (hasPoints) {
      const { gridSize } = $canvasView.get()

      // Calculate content bounds in pixels (add padding for margin)
      const contentWidth = (maxX - minX + 1) * gridSize + gridSize * 2
      const contentHeight = (maxY - minY + 1) * gridSize + gridSize * 2

      // Viewport size
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Zoom to fit with cap
      const zoomX = viewportWidth / contentWidth
      const zoomY = viewportHeight / contentHeight
      const targetZoom = Math.min(zoomX, zoomY, 2.0)

      // Center of content in pixels
      const centerX = ((minX + maxX) / 2) * gridSize
      const centerY = ((minY + maxY) / 2) * gridSize

      const viewportCenterX = viewportWidth / 2
      const viewportCenterY = viewportHeight / 2

      $canvasView.setKey("zoom", targetZoom)
      $canvasView.setKey("panOffset", {
        x: viewportCenterX - centerX * targetZoom,
        y: viewportCenterY - centerY * targetZoom,
      })

      render()
    }
  }, [render])

  // Compatibility function for active layer outline (renders only active group)
  const renderActiveLayerOutlineCompat = useCallback(
    (activeLayer: Layer) => {
      if (!renderer || !renderer.context) return

      const ctx = renderer.context
      ctx.save()
      ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
      ctx.scale(canvasView.zoom, canvasView.zoom)

      // Get points for the active group only (not all groups)
      const groupIdx = Math.min(activeGroupIndex, activeLayer.groups.length - 1)
      const activeGroup = activeLayer.groups[Math.max(0, groupIdx)]
      const outlinePoints = activeGroup
        ? activeGroup.points
        : getLayerPoints(activeLayer)

      // Use current visible viewport for outline rendering
      const viewport = calculateCurrentViewport()
      for (let x = viewport.minX; x <= viewport.maxX; x++) {
        for (let y = viewport.minY; y <= viewport.maxY; y++) {
          const pointKey = `${x},${y}`
          if (outlinePoints.has(pointKey)) {
            // Create temporary RasterPoint for compatibility
            const point = {
              x,
              y,
              neighbors: [
                [false, false, false],
                [false, false, false],
                [false, false, false],
              ],
            }

            // Update neighbors
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx
                const ny = y + dy
                const nkey = `${nx},${ny}`
                point.neighbors[dx + 1][dy + 1] = outlinePoints.has(nkey)
              }
            }

            drawActiveLayerOutline(
              ctx,
              point,
              canvasView.gridSize,
              getCanvasColor("--canvas-outline-active"),
              2,
            )
          }
        }
      }

      ctx.restore()
    },
    [renderer, canvasView, activeGroupIndex, calculateCurrentViewport],
  )

  // Initialize canvas on mount and when ready
  useEffect(() => {
    if (!isReady) return

    initializeCanvas()
    render()

    const handleResize = () => {
      initializeCanvas(true)
      render()
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [initializeCanvas, render, isReady])

  // Trigger render when stores change
  useEffect(() => {
    if (isReady) {
      render()
    }
  }, [canvasView, layersState, render, isReady])

  // Invalidate caches when layers change (covers non-paint edits like paste/selection)
  useEffect(() => {
    layersState.layers.forEach((layer) => {
      blobEngine.invalidateLayer(layer.id)
    })
  }, [layersState.layers, blobEngine])

  const paintAtPosition = useCallback(
    (
      clientX: number,
      clientY: number,
      isOptionHeld: boolean = false,
      lastCoords?: { x: number; y: number },
    ) => {
      const coords = getGridCoordinates(clientX, clientY)
      if (!coords) return

      const currentLayersState = $layersState.get()
      const { activeLayerId, layers } = currentLayersState
      if (activeLayerId === null) return

      const activeLayer = layers.find((l) => l.id === activeLayerId)
      if (!activeLayer) return

      let effectiveTool = currentTool
      if (isOptionHeld && (currentTool === "draw" || currentTool === "erase")) {
        effectiveTool = currentTool === "draw" ? "erase" : "draw"
      }

      const pointsToModify = new Set<string>()
      if (lastCoords) {
        // Bresenham line algorithm for continuous strokes
        const dx = Math.abs(coords.x - lastCoords.x)
        const dy = Math.abs(coords.y - lastCoords.y)
        const sx = lastCoords.x < coords.x ? 1 : -1
        const sy = lastCoords.y < coords.y ? 1 : -1
        let err = dx - dy

        let x = lastCoords.x
        let y = lastCoords.y

        while (true) {
          pointsToModify.add(`${x},${y}`)
          if (x === coords.x && y === coords.y) break
          const e2 = 2 * err
          if (e2 > -dy) {
            err -= dy
            x += sx
          }
          if (e2 < dx) {
            err += dx
            y += sy
          }
        }
      } else {
        pointsToModify.add(`${coords.x},${coords.y}`)
      }

      // Get the active group (based on activeGroupIndex)
      const groupIdx = Math.min(activeGroupIndex, activeLayer.groups.length - 1)
      const activeGroup = activeLayer.groups[Math.max(0, groupIdx)]
      if (!activeGroup) return
      const newPoints = new Set(activeGroup.points)
      pointsToModify.forEach((key) => {
        if (effectiveTool === "draw") {
          newPoints.add(key)
        } else if (effectiveTool === "erase") {
          newPoints.delete(key)
          // Also clear point modifications when erasing
          clearPointModifications(activeLayerId, key)
        }
      })

      // Apply update to the active group
      updateGroupPoints(activeLayerId, newPoints, activeGroup.id)

      // Targeted cache invalidation for the edited region (+1-cell padding for neighbors)
      if (pointsToModify.size > 0) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity
        for (const key of pointsToModify) {
          const [x, y] = key.split(",").map(Number)
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
        blobEngine.invalidateLayer(activeLayerId, {
          minX: minX - 1,
          minY: minY - 1,
          maxX: maxX + 1,
          maxY: maxY + 1,
        })
      }
      return coords
    },
    [getGridCoordinates, currentTool, activeGroupIndex],
  )

  // Mouse interaction handlers
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    const handleMouseDown = (e: MouseEvent) => {
      setIsDragging(true)
      const isInvertHeld = e.altKey || e.button === 2

      if (currentTool === "pan") {
        setPanStart({ x: e.clientX, y: e.clientY })
      } else if (currentTool === "select") {
        const grid = getGridCoordinates(e.clientX, e.clientY)
        const fp = $selectionState.get().floatingPaste
        if (fp) {
          // Already floating — record drag start so the user can reposition it
          moveDragStartRef.current = grid
        } else if (grid && selection.isInsideSelection(grid.x, grid.y) && selection.hasSelection) {
          // Lift the selection into floating state, then start drag.
          // Shift = active layer only.
          selection.liftSelection(e.shiftKey)
          moveDragStartRef.current = grid
        } else {
          // Start a new selection rectangle
          moveDragStartRef.current = null
          selection.startSelection(e.clientX, e.clientY, getGridCoordinates)
        }
      } else if (currentTool === "cutout") {
        pushHistory($layersState.get().layers)
        handleCutoutClick(e.clientX, e.clientY, isInvertHeld)
      } else if (currentTool === "override") {
        pushHistory($layersState.get().layers)
        handleOverrideClick(e.clientX, e.clientY, isInvertHeld)
      } else if (currentTool === "measure") {
        $measureState.set({
          start: { x: e.clientX, y: e.clientY },
          end: { x: e.clientX, y: e.clientY },
          isDragging: true,
        })
      } else if (currentTool === "export") {
        if (e.altKey) {
          // Alt+click: delete the rect under the cursor
          const grid = getGridCoordinates(e.clientX, e.clientY)
          if (grid) {
            const hit = exportRectsHook.getHitRect(grid.x, grid.y)
            if (hit) exportRectsHook.deleteById(hit.id)
          }
        } else {
          exportRectsHook.startDraw(e.clientX, e.clientY, getGridCoordinates)
        }
      } else {
        // draw or erase — snapshot before the stroke begins
        pushHistory($layersState.get().layers)
        const newCoords = paintAtPosition(e.clientX, e.clientY, isInvertHeld)
        setLastPaintCoords(newCoords || null)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Always track the last mouse position so paste can use it
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }

      // Cutout hover hit-test runs regardless of drag state
      if (currentTool === "cutout") {
        const hit = getHoveredCutout(e.clientX, e.clientY)
        const prev = hoveredCutoutRef.current
        const prevKey = prev ? `${prev.pointKey}:${prev.index}` : null
        const hitKey = hit ? `${hit.pointKey}:${hit.index}` : null
        if (hitKey !== prevKey) {
          hoveredCutoutRef.current = hit
          render()
        }
      }

      if (isDragging) {
        const isInvertHeld = e.altKey || !!(e.buttons & 2)

        if (currentTool === "pan") {
          const deltaX = e.clientX - panStart.x
          const deltaY = e.clientY - panStart.y
          const currentCanvasView = $canvasView.get()

          $canvasView.setKey("panOffset", {
            x: currentCanvasView.panOffset.x + deltaX,
            y: currentCanvasView.panOffset.y + deltaY,
          })
          setPanStart({ x: e.clientX, y: e.clientY })
        } else if (currentTool === "select") {
          if (moveDragStartRef.current) {
            // Moving a floating paste via drag — compute delta from last grid cell
            const grid = getGridCoordinates(e.clientX, e.clientY)
            if (grid) {
              const dx = grid.x - moveDragStartRef.current.x
              const dy = grid.y - moveDragStartRef.current.y
              if (dx !== 0 || dy !== 0) {
                selection.moveFloatingPaste(dx, dy)
                moveDragStartRef.current = grid
              }
            }
          } else {
            selection.updateSelection(e.clientX, e.clientY, getGridCoordinates)
          }
        } else if (currentTool === "cutout") {
          // No drag behavior for cutout (click-only)
        } else if (currentTool === "override") {
          // Allow painting overrides while dragging
          handleOverrideClick(e.clientX, e.clientY, isInvertHeld)
        } else if (currentTool === "measure") {
          const current = $measureState.get()
          if (current.isDragging && current.start) {
            $measureState.set({
              ...current,
              end: { x: e.clientX, y: e.clientY },
            })
          }
        } else if (currentTool === "export") {
          exportRectsHook.updateDraw(e.clientX, e.clientY, getGridCoordinates)
        } else {
          // draw or erase
          const newCoords = paintAtPosition(
            e.clientX,
            e.clientY,
            isInvertHeld,
            lastPaintCoords || undefined,
          )
          setLastPaintCoords(newCoords || null)
        }
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setLastPaintCoords(null)
      if (currentTool === "select" && moveDragStartRef.current) {
        // End the drag — leave the float in place so Enter/Escape can finish it
        moveDragStartRef.current = null
      }
      if (currentTool === "measure") {
        const current = $measureState.get()
        $measureState.set({ ...current, isDragging: false })
      }
      if (currentTool === "export" && exportRectsHook.isDrawing) {
        exportRectsHook.commitDraw()
      }
    }

    const handleMouseLeave = () => {
      handleMouseUp()
      if (currentTool === "cutout" && hoveredCutoutRef.current !== null) {
        hoveredCutoutRef.current = null
        render()
      }
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("mouseleave", handleMouseLeave)
    canvas.addEventListener("contextmenu", handleContextMenu)

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("mouseleave", handleMouseLeave)
      canvas.removeEventListener("contextmenu", handleContextMenu)
    }
  }, [
    paintAtPosition,
    handleCutoutClick,
    handleOverrideClick,
    currentTool,
    isDragging,
    panStart,
    lastPaintCoords,
    selection.startSelection,
    selection.updateSelection,
    selection.hasSelection,
    selection.isInsideSelection,
    selection.liftSelection,
    selection.moveFloatingPaste,
    getGridCoordinates,
    getHoveredCutout,
    render,
    exportRectsHook.startDraw,
    exportRectsHook.updateDraw,
    exportRectsHook.commitDraw,
    exportRectsHook.isDrawing,
  ])

  // Wheel event handler for zoom/pan (same as original)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey) {
        // Zoom gesture
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const currentZoom = canvasView.zoom
        const newZoom = Math.max(
          0.005,
          Math.min(15.0, currentZoom * zoomFactor),
        )

        // Zoom towards mouse position
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        // Calculate world position at mouse before zoom
        const worldX = (mouseX - canvasView.panOffset.x) / currentZoom
        const worldY = (mouseY - canvasView.panOffset.y) / currentZoom

        $canvasView.setKey("zoom", newZoom)
        $canvasView.setKey("panOffset", {
          x: mouseX - worldX * newZoom,
          y: mouseY - worldY * newZoom,
        })
      } else {
        // Pan gesture (two-finger scroll)
        const currentCanvasView = $canvasView.get()
        $canvasView.setKey("panOffset", {
          x: currentCanvasView.panOffset.x - e.deltaX,
          y: currentCanvasView.panOffset.y - e.deltaY,
        })
      }
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false })

    return () => {
      canvas.removeEventListener("wheel", handleWheel)
    }
  }, [canvasView])

  // Keyboard shortcuts for copy/paste/move
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return // Only work when no input is focused

      const floatingPaste = $selectionState.get().floatingPaste

      // ── Floating paste takes priority when active ──────────────────────
      if (floatingPaste) {
        // Arrow keys move the floating paste; Shift = 10 units
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          if (e.key === "ArrowUp")    selection.moveFloatingPaste(0, -step)
          if (e.key === "ArrowDown")  selection.moveFloatingPaste(0, step)
          if (e.key === "ArrowLeft")  selection.moveFloatingPaste(-step, 0)
          if (e.key === "ArrowRight") selection.moveFloatingPaste(step, 0)
          return
        }

        // Enter bakes the floating paste
        if (e.key === "Enter") {
          e.preventDefault()
          selection.bakeFloatingPaste()
          return
        }

        // Escape cancels the floating paste
        if (e.key === "Escape") {
          e.preventDefault()
          selection.cancelFloatingPaste()
          return
        }
      }

      // ── Copy ────────────────────────────────────────────────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.copySelection()
        }
      }

      // ── Paste (enters floating mode at cursor position) ─────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (currentTool === "select") {
          e.preventDefault()
          const { x: mx, y: my } = lastMousePosRef.current
          selection.pasteSelection(mx, my, getGridCoordinates)
        }
      }

      // ── Arrow key move: lift-then-move (select tool with active selection) ─
      // The floating-paste arrow block above handles the case where floatingPaste
      // is already set. This block handles the case where we have a live selection
      // but no floating paste yet — we lift first, then immediately move.
      if (
        currentTool === "select" &&
        selection.hasSelection &&
        !floatingPaste &&
        (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        e.preventDefault()
        // Shift = active layer only; Alt = 10-unit step
        const activeLayerOnly = e.shiftKey
        const step = e.altKey ? 10 : 1
        // Lift into floating state (clears selection bounds)
        selection.liftSelection(activeLayerOnly)
        // Then immediately nudge the floating paste
        if (e.key === "ArrowUp")    selection.moveFloatingPaste(0, -step)
        if (e.key === "ArrowDown")  selection.moveFloatingPaste(0, step)
        if (e.key === "ArrowLeft")  selection.moveFloatingPaste(-step, 0)
        if (e.key === "ArrowRight") selection.moveFloatingPaste(step, 0)
        return
      }

      // ── Center view ─────────────────────────────────────────────────────
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "c" || e.key === "C")
      ) {
        e.preventDefault()
        centerCanvasToContent()
      }

      // ── Escape: clear selection ──────────────────────────────────────────
      if (e.key === "Escape") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.clearSelection()
        }
      }

      // ── Delete / Backspace ───────────────────────────────────────────────
      if (e.key === "Delete" || e.key === "Backspace") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.deleteSelection(e.shiftKey)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [
    currentTool,
    selection.hasSelection,
    selection.copySelection,
    selection.pasteSelection,
    selection.clearSelection,
    selection.deleteSelection,
    selection.liftSelection,
    selection.moveFloatingPaste,
    selection.bakeFloatingPaste,
    selection.cancelFloatingPaste,
    getGridCoordinates,
    centerCanvasToContent,
  ])

  // Imperative handle (same interface as original)
  useImperativeHandle(ref, () => ({
    reset: () => {
      resetDrawing()
      blobEngine.clearCaches()
      render()
    },

    setGridSize: (operation: "+" | "-") => {
      const step = 25
      const newSize =
        operation === "+"
          ? Math.min(150, canvasView.gridSize + step)
          : Math.max(25, canvasView.gridSize - step)

      $canvasView.setKey("gridSize", newSize)
      blobEngine.clearCaches()
      initializeCanvas()
      render()
    },

    setBorderWidth: (width: number) => {
      const clampedWidth = Math.max(0, Math.min(10, width))
      $canvasView.setKey("borderWidth", clampedWidth)
      blobEngine.clearCaches()
      render()
    },

    setMmPerUnit: (mmPerUnit: number) => {
      const clampedMmPerUnit = Math.max(0.1, Math.min(100, mmPerUnit))
      $canvasView.setKey("mmPerUnit", clampedMmPerUnit)
      // Re-render so cutout sizes (stored in mm) update correctly
      render()
    },

    saveIMG: () => {
      const canvas = canvasRef.current
      if (!canvas) return

      // When the select tool is active and there is a selection, export only
      // the points within that selection. Otherwise export the full drawing.
      const selBounds =
        currentTool === "select" &&
        selection.hasSelection &&
        selection.selectionStart &&
        selection.selectionEnd
          ? {
              minX: Math.min(
                selection.selectionStart.x,
                selection.selectionEnd.x,
              ),
              minY: Math.min(
                selection.selectionStart.y,
                selection.selectionEnd.y,
              ),
              maxX: Math.max(
                selection.selectionStart.x,
                selection.selectionEnd.x,
              ),
              maxY: Math.max(
                selection.selectionStart.y,
                selection.selectionEnd.y,
              ),
            }
          : null

      const layersToExport = selBounds
        ? clipLayersToSelection(layersState.layers, selBounds)
        : layersState.layers

      // Skip PNG export when exporting a selection (PNG is a viewport
      // screenshot and cannot be easily cropped to grid coordinates)
      if (!selBounds) {
        const pngLink = document.createElement("a")
        pngLink.download = `${drawingMeta.name || "gridpaint"}.png`
        pngLink.href = canvas.toDataURL()
        pngLink.click()
      }

      // Export JSON data (scoped to selection when active)
      const currentDocument = {
        ...drawingMeta,
        ...canvasView,
        layers: layersToExport,
      }
      exportDrawingAsJSON(currentDocument)

      // Export SVG files for each layer (scoped to selection when active)
      setTimeout(() => {
        exportAllLayersAsSVG(
          layersToExport,
          canvasView.gridSize,
          canvasView.borderWidth,
          drawingMeta.name,
          canvasView.mmPerUnit,
        )
      }, 200)
    },

    setActiveLayer: (layerId: number | null) => {
      setActiveLayer(layerId)
      setActiveGroupIndex(0)
      render()
    },

    toggleLayerVisibility: (layerId: number) => {
      toggleLayerVisibility(layerId)
      blobEngine.invalidateLayer(layerId)
      render()
    },

    createNewLayer: () => {
      if (layersState.layers.length >= 6) return false
      addLayer()
      render()
      return true
    },

    deleteLayer: (layerId: number) => {
      if (layersState.layers.length <= 1) return

      const layers = layersState.layers.filter((l) => l.id !== layerId)
      $layersState.setKey("layers", layers)

      if (layersState.activeLayerId === layerId) {
        setActiveLayer(layers.length > 0 ? layers[0].id : null)
      }

      blobEngine.invalidateLayer(layerId)
      render()
    },

    toggleLayerRenderStyle: (layerId: number) => {
      toggleLayerRenderStyle(layerId)
      blobEngine.invalidateLayer(layerId)
      render()
    },

    getLayerState: () => ({
      layers: [...layersState.layers],
      activeLayerId: layersState.activeLayerId,
    }),

    setPanOffset: (x: number, y: number) => {
      $canvasView.setKey("panOffset", { x, y })
      render()
    },

    centerCanvas: () => {
      centerCanvasToContent()
    },

    zoomIn: () => {
      const currentZoom = canvasView.zoom
      const newZoom = Math.min(currentZoom * 1.5, 15.0) // Cap at 15x zoom

      // Zoom towards viewport center
      const viewportCenterX = window.innerWidth / 2
      const viewportCenterY = window.innerHeight / 2

      // Calculate world position at viewport center before zoom
      const worldX = (viewportCenterX - canvasView.panOffset.x) / currentZoom
      const worldY = (viewportCenterY - canvasView.panOffset.y) / currentZoom

      $canvasView.setKey("zoom", newZoom)
      $canvasView.setKey("panOffset", {
        x: viewportCenterX - worldX * newZoom,
        y: viewportCenterY - worldY * newZoom,
      })

      render()
    },

    zoomOut: () => {
      const currentZoom = canvasView.zoom
      const newZoom = Math.max(currentZoom / 1.5, 0.005) // Min zoom 0.005x

      // Zoom towards viewport center
      const viewportCenterX = window.innerWidth / 2
      const viewportCenterY = window.innerHeight / 2

      // Calculate world position at viewport center before zoom
      const worldX = (viewportCenterX - canvasView.panOffset.x) / currentZoom
      const worldY = (viewportCenterY - canvasView.panOffset.y) / currentZoom

      $canvasView.setKey("zoom", newZoom)
      $canvasView.setKey("panOffset", {
        x: viewportCenterX - worldX * newZoom,
        y: viewportCenterY - worldY * newZoom,
      })

      render()
    },

    setName: (name: string) => {
      $drawingMeta.setKey("name", name)
    },

    createOrActivateLayer: (layerId: number) => {
      createOrActivateLayer(layerId)
      render()
    },
  }))

  // Hot reload hook for development
  useEffect(() => {
    if (import.meta.hot) {
      const handleHotUpdate = () => {
        console.log("Hot reload detected - forcing canvas redraw")
        blobEngine.clearCaches()

        // Force invalidation of all layers
        layersState.layers.forEach((layer) => {
          blobEngine.invalidateLayer(layer.id)
        })

        // Reinitialize canvas and force a complete re-render
        setTimeout(() => {
          initializeCanvas(true)
          render()
        }, 100)
      }

      import.meta.hot.on("vite:afterUpdate", handleHotUpdate)

      // Use dispose to clean up on component unmount
      import.meta.hot.dispose(() => {
        // Cleanup happens here when the module is replaced
      })
    }
  }, [blobEngine, initializeCanvas, render])

  // Don't render until state is ready
  if (!isReady) {
    return (
      <div className='w-full h-full bg-gray-100 flex items-center justify-center'>
        <div className='text-gray-500'>Loading...</div>
      </div>
    )
  }

  const getCursorClass = () => {
    switch (currentTool) {
      case "draw":
      case "erase":
      case "cutout":
      case "override":
        return "cursor-crosshair"
      case "pan":
        return "cursor-grab"
      case "select":
        return "cursor-pointer"
      case "measure":
        return "cursor-crosshair"
      case "export":
        return "cursor-crosshair"
      default:
        return "cursor-crosshair"
    }
  }

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${getCursorClass()}`}
        style={{ display: "block" }}
      />
      <ExportRectOverlay
        canvasView={canvasView}
        onQuantityChange={exportRectsHook.setQuantity}
        onNameChange={exportRectsHook.setName}
        onDelete={exportRectsHook.deleteById}
        visible={currentTool === "export"}
      />
    </div>
  )
})
