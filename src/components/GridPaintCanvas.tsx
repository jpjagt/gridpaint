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
import type { Tool } from "./ToolSelection"
import { useSelection } from "@/hooks/useSelection"
import { useSelectionRenderer } from "@/hooks/useSelectionRenderer"

// New blob engine imports
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { Canvas2DRenderer } from "@/lib/blob-engine/renderers/Canvas2DRenderer"
import type {
  GridLayer as BlobGridLayer,
  SpatialRegion,
} from "@/lib/blob-engine/types"

// Existing imports for compatibility
import { drawActiveLayerOutline } from "@/lib/gridpaint/drawActiveOutline"
import { showActiveLayerOutline } from "@/stores/ui"
import useDrawingState from "@/hooks/useDrawingState"
import {
  exportDrawingAsJSON,
  exportAllLayersAsSVG,
} from "@/lib/export/exportUtils"
import {
  type Layer,
  $canvasView,
  $layersState,
  $drawingMeta,
  addLayer,
  setActiveLayer,
  toggleLayerVisibility,
  toggleLayerRenderStyle,
  createOrActivateLayer,
  updateLayerPoints,
  resetDrawing,
} from "@/stores/drawingStores"

// Theme color utility
const getCanvasColor = (varName: string): string => {
  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return hslValue ? `hsl(${hslValue})` : "#000000"
}

interface GridPaintCanvasProps {
  currentTool: Tool
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
>(({ currentTool, drawingId }, ref) => {
  const $showActiveLayerOutline = useStore(showActiveLayerOutline)
  const canvasView = useStore($canvasView)
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

  // Selection hooks
  const selection = useSelection()
  const { renderSelectionRectangle } = useSelectionRenderer()

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
        points: new Set(layer.points),
        isVisible: layer.isVisible,
        renderStyle: layer.renderStyle,
      }))
    },
    [],
  )

  // Calculate expanded viewport for buffering (larger than visible area)
  const calculateExpandedViewport = useCallback((): SpatialRegion => {
    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight
    const { gridSize } = canvasView

    // Use a larger buffer that doesn't depend on current pan/zoom
    // This creates a viewport that's ~3x the screen size in each direction
    const bufferMultiplier = 3
    const bufferWidth = displayWidth * bufferMultiplier
    const bufferHeight = displayHeight * bufferMultiplier

    // Calculate buffer bounds assuming worst case (minimum zoom)
    const minZoom = 0.1
    const maxGridWidth = Math.ceil(bufferWidth / (gridSize * minZoom))
    const maxGridHeight = Math.ceil(bufferHeight / (gridSize * minZoom))

    // Center the buffer around origin (we can adjust this later if needed)
    const centerX = 0
    const centerY = 0
    const halfWidth = Math.ceil(maxGridWidth / 2)
    const halfHeight = Math.ceil(maxGridHeight / 2)

    return {
      minX: centerX - halfWidth,
      minY: centerY - halfHeight,
      maxX: centerX + halfWidth,
      maxY: centerY + halfHeight,
    }
  }, [canvasView.gridSize]) // Only depends on grid size, not pan/zoom

  // Cache geometry generation - only regenerate when layers or settings change
  const cachedGeometry = useMemo(() => {
    if (!isReady) return null

    console.log("Regenerating cached geometry - layers changed")

    // Convert layers to blob format
    const blobLayers = convertLayersToBlobFormat(layersState.layers)

    // Calculate expanded viewport for buffering
    const expandedViewport = calculateExpandedViewport()

    // Generate geometry using blob engine with expanded viewport
    return blobEngine.generateGeometry(
      blobLayers,
      canvasView.gridSize,
      canvasView.borderWidth,
      expandedViewport,
    )
  }, [
    isReady,
    blobEngine,
    convertLayersToBlobFormat,
    layersState.layers,
    canvasView.gridSize,
    canvasView.borderWidth,
    calculateExpandedViewport,
  ]) // No pan/zoom dependencies!

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
      { style: baseStyle, transform },
      getLayerStyle,
    )

    // Render active layer outline if enabled
    if ($showActiveLayerOutline && layersState.activeLayerId !== null) {
      const activeLayer = layersState.layers.find(
        (l) => l.id === layersState.activeLayerId,
      )
      if (activeLayer && activeLayer.isVisible) {
        // For now, use the old outline rendering system for compatibility
        // TODO: Implement outline rendering in the new system
        renderActiveLayerOutlineCompat(activeLayer)
      }
    }

    // Render selection rectangle if active
    if (currentTool === "select" && selection.hasSelection && renderer) {
      renderSelectionRectangle(
        renderer,
        selection.selectionStart!,
        selection.selectionEnd!,
        canvasView
      )
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
    currentTool,
    selection.hasSelection,
    selection.selectionStart,
    selection.selectionEnd,
    renderSelectionRectangle,
  ]) // Much simpler dependencies!

  // Calculate current visible viewport for outline rendering
  const calculateCurrentViewport = useCallback((): SpatialRegion => {
    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight
    const { zoom, panOffset, gridSize } = canvasView

    const viewportMinX = Math.floor(-panOffset.x / (gridSize * zoom)) - 2
    const viewportMaxX =
      Math.ceil((displayWidth - panOffset.x) / (gridSize * zoom)) + 2
    const viewportMinY = Math.floor(-panOffset.y / (gridSize * zoom)) - 2
    const viewportMaxY =
      Math.ceil((displayHeight - panOffset.y) / (gridSize * zoom)) + 2

    return {
      minX: viewportMinX,
      minY: viewportMinY,
      maxX: viewportMaxX,
      maxY: viewportMaxY,
    }
  }, [canvasView])

  // Compatibility function for active layer outline (temporary)
  const renderActiveLayerOutlineCompat = useCallback(
    (activeLayer: Layer) => {
      if (!renderer || !renderer.context) return

      const ctx = renderer.context
      ctx.save()
      ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
      ctx.scale(canvasView.zoom, canvasView.zoom)

      // Use current visible viewport for outline rendering
      const viewport = calculateCurrentViewport()
      for (let x = viewport.minX; x <= viewport.maxX; x++) {
        for (let y = viewport.minY; y <= viewport.maxY; y++) {
          const pointKey = `${x},${y}`
          if (activeLayer.points.has(pointKey)) {
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
                point.neighbors[dx + 1][dy + 1] = activeLayer.points.has(nkey)
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
    [renderer, canvasView, calculateCurrentViewport],
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

  // Invalidate cache when layers change
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

      const newPoints = new Set(activeLayer.points)
      pointsToModify.forEach((key) => {
        if (effectiveTool === "draw") {
          newPoints.add(key)
        } else if (effectiveTool === "erase") {
          newPoints.delete(key)
        }
      })

      updateLayerPoints(activeLayerId, newPoints)
      return coords
    },
    [getGridCoordinates, currentTool],
  )

  // Mouse interaction handlers (same as original)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseDown = (e: MouseEvent) => {
      setIsDragging(true)

      if (currentTool === "pan") {
        setPanStart({ x: e.clientX, y: e.clientY })
      } else if (currentTool === "select") {
        selection.startSelection(e.clientX, e.clientY, getGridCoordinates)
      } else {
        const newCoords = paintAtPosition(e.clientX, e.clientY, e.altKey)
        setLastPaintCoords(newCoords || null)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
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
          selection.updateSelection(e.clientX, e.clientY, getGridCoordinates)
        } else {
          const newCoords = paintAtPosition(
            e.clientX,
            e.clientY,
            e.altKey,
            lastPaintCoords || undefined,
          )
          setLastPaintCoords(newCoords || null)
        }
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setLastPaintCoords(null)
    }


    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("mouseleave", handleMouseUp)

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("mouseleave", handleMouseUp)
    }
  }, [
    paintAtPosition,
    currentTool,
    isDragging,
    panStart,
    lastPaintCoords,
    canvasView,
    selection.startSelection,
    selection.updateSelection,
    getGridCoordinates,
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
        const newZoom = Math.max(0.1, Math.min(5.0, currentZoom * zoomFactor))

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

  // Keyboard shortcuts for copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return // Only work when no input is focused

      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.copySelection()
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (currentTool === "select") {
          e.preventDefault()
          // Get current mouse position for paste location
          const canvas = canvasRef.current
          if (canvas) {
            const rect = canvas.getBoundingClientRect()
            const centerX = rect.left + rect.width / 2
            const centerY = rect.top + rect.height / 2
            selection.pasteSelection(centerX, centerY, getGridCoordinates)
          }
        }
      }

      if (e.key === "Escape") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.clearSelection()
        }
      }

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
    getGridCoordinates,
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
      // No need to clear caches or re-render as this only affects export
    },

    saveIMG: () => {
      const canvas = canvasRef.current
      if (!canvas) return

      // Export PNG
      const pngLink = document.createElement("a")
      pngLink.download = `${drawingMeta.name || "gridpaint"}.png`
      pngLink.href = canvas.toDataURL()
      pngLink.click()

      // Export JSON data
      const currentDocument = {
        ...drawingMeta,
        ...canvasView,
        layers: layersState.layers,
      }
      exportDrawingAsJSON(currentDocument)

      // Export SVG files for each layer
      setTimeout(() => {
        exportAllLayersAsSVG(
          layersState.layers,
          canvasView.gridSize,
          canvasView.borderWidth,
          drawingMeta.name,
          canvasView.mmPerUnit,
        )
      }, 200)
    },

    setActiveLayer: (layerId: number | null) => {
      setActiveLayer(layerId)
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
      // Calculate bounds from all visible layers
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      let hasPoints = false

      layersState.layers.forEach((layer) => {
        if (!layer.isVisible) return

        Array.from(layer.points).forEach((pointKey) => {
          const [x, y] = pointKey.split(",").map(Number)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
          hasPoints = true
        })
      })

      if (hasPoints) {
        const { gridSize } = canvasView

        // Calculate content bounds in pixels (add padding for margin)
        const contentWidth = (maxX - minX + 1) * gridSize + gridSize * 2
        const contentHeight = (maxY - minY + 1) * gridSize + gridSize * 2

        // Calculate viewport size
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        // Calculate zoom to fit content with margin
        const zoomX = viewportWidth / contentWidth
        const zoomY = viewportHeight / contentHeight
        const targetZoom = Math.min(zoomX, zoomY, 2.0) // Cap at 2x zoom

        // Calculate center point in pixels
        const centerX = ((minX + maxX) / 2) * gridSize
        const centerY = ((minY + maxY) / 2) * gridSize

        // Set zoom and pan
        const viewportCenterX = viewportWidth / 2
        const viewportCenterY = viewportHeight / 2

        $canvasView.setKey("zoom", targetZoom)
        $canvasView.setKey("panOffset", {
          x: viewportCenterX - centerX * targetZoom,
          y: viewportCenterY - centerY * targetZoom,
        })

        render()
      }
    },

    zoomIn: () => {
      const currentZoom = canvasView.zoom
      const newZoom = Math.min(currentZoom * 1.5, 5.0) // Cap at 5x zoom

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
      const newZoom = Math.max(currentZoom / 1.5, 0.1) // Min zoom 0.1x

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
        return "cursor-crosshair"
      case "erase":
        return "cursor-crosshair"
      case "pan":
        return "cursor-grab"
      case "select":
        return "cursor-pointer"
      default:
        return "cursor-crosshair"
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${getCursorClass()}`}
      style={{ display: "block" }}
    />
  )
})
