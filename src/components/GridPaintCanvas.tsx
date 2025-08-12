import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react"
import { useStore } from "@nanostores/react"
import { drawActiveLayerOutline } from "@/lib/gridpaint/drawActiveOutline"
import type { Tool } from "./ToolSelection"
import { showActiveLayerOutline } from "@/stores/ui"
import useDrawingState from "@/hooks/useDrawingState"
import { exportDrawingAsJSON, exportAllLayersAsSVG } from "@/lib/export/exportUtils"
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

interface GridPaintCanvasProps {
  currentTool: Tool
  drawingId: string
  onNameChange?: (name: string) => void
}

export interface GridPaintCanvasMethods {
  reset: () => void
  setGridSize: (operation: "+" | "-") => void
  setBorderWidth: (width: number) => void
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

class RasterPoint {
  x: number
  y: number
  neighbors: boolean[][] = []

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
    for (let i = 0; i < 3; i++) {
      this.neighbors[i] = [false, false, false]
    }
  }

  updateNeighbors(layers: Layer[], gridSize: number) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = this.x + dx
        const ny = this.y + dy
        const key = `${nx},${ny}`

        let hasNeighbor = false
        for (const layer of layers) {
          if (layer.isVisible && layer.points.has(key)) {
            hasNeighbor = true
            break
          }
        }

        this.neighbors[dx + 1][dy + 1] = hasNeighbor
      }
    }
  }

  renderBlobBorderOnly(
    ctx: CanvasRenderingContext2D,
    gridSize: number,
    color: string,
    borderWidth: number,
  ) {
    const centerX = this.x * gridSize + gridSize / 2
    const centerY = this.y * gridSize + gridSize / 2
    const elementSize = gridSize / 2 + borderWidth
    const magicNr = 0.553

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.strokeStyle = color
    ctx.lineWidth = borderWidth
    ctx.lineJoin = "round"
    ctx.lineCap = "round"

    const isCenter = this.neighbors[1][1]

    if (isCenter) {
      // DOWN RIGHT quadrant (0 degrees)
      ctx.save()
      if (
        this.neighbors[2][1] ||
        this.neighbors[2][2] ||
        this.neighbors[1][2]
      ) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // DOWN LEFT quadrant (90 degrees)
      ctx.save()
      ctx.rotate(Math.PI / 2)
      if (
        this.neighbors[0][1] ||
        this.neighbors[0][2] ||
        this.neighbors[1][2]
      ) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // UP LEFT quadrant (180 degrees)
      ctx.save()
      ctx.rotate(Math.PI)
      if (
        this.neighbors[0][1] ||
        this.neighbors[0][0] ||
        this.neighbors[1][0]
      ) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // UP RIGHT quadrant (270 degrees)
      ctx.save()
      ctx.rotate((3 * Math.PI) / 2)
      if (
        this.neighbors[1][0] ||
        this.neighbors[2][0] ||
        this.neighbors[2][1]
      ) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()
    } else {
      // Diagonal bridges
      if (this.neighbors[2][1] && this.neighbors[1][2]) {
        ctx.save()
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[1][2] && this.neighbors[0][1]) {
        ctx.save()
        ctx.rotate(Math.PI / 2)
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[0][1] && this.neighbors[1][0]) {
        ctx.save()
        ctx.rotate(Math.PI)
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[1][0] && this.neighbors[2][1]) {
        ctx.save()
        ctx.rotate((3 * Math.PI) / 2)
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }
    }

    ctx.restore()
  }

  renderBlob(
    ctx: CanvasRenderingContext2D,
    gridSize: number,
    color: string,
    borderWidth: number,
  ) {
    const centerX = this.x * gridSize + gridSize / 2
    const centerY = this.y * gridSize + gridSize / 2
    const elementSize = gridSize / 2 + borderWidth
    const magicNr = 0.553

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = borderWidth
    ctx.lineJoin = "round"
    ctx.lineCap = "round"

    const isCenter = this.neighbors[1][1]

    if (isCenter) {
      // DOWN RIGHT quadrant (0 degrees)
      ctx.save()
      if (
        this.neighbors[2][1] ||
        this.neighbors[2][2] ||
        this.neighbors[1][2]
      ) {
        this.drawElement0(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // DOWN LEFT quadrant (90 degrees)
      ctx.save()
      ctx.rotate(Math.PI / 2)
      if (
        this.neighbors[0][1] ||
        this.neighbors[0][2] ||
        this.neighbors[1][2]
      ) {
        this.drawElement0(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // UP LEFT quadrant (180 degrees)
      ctx.save()
      ctx.rotate(Math.PI)
      if (
        this.neighbors[0][1] ||
        this.neighbors[0][0] ||
        this.neighbors[1][0]
      ) {
        this.drawElement0(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()

      // UP RIGHT quadrant (270 degrees)
      ctx.save()
      ctx.rotate((3 * Math.PI) / 2)
      if (
        this.neighbors[1][0] ||
        this.neighbors[2][0] ||
        this.neighbors[2][1]
      ) {
        this.drawElement0(ctx, elementSize, borderWidth)
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth)
      }
      ctx.restore()
    } else {
      // Diagonal bridges
      if (this.neighbors[2][1] && this.neighbors[1][2]) {
        ctx.save()
        this.drawElement2(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[1][2] && this.neighbors[0][1]) {
        ctx.save()
        ctx.rotate(Math.PI / 2)
        this.drawElement2(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[0][1] && this.neighbors[1][0]) {
        ctx.save()
        ctx.rotate(Math.PI)
        this.drawElement2(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }

      if (this.neighbors[1][0] && this.neighbors[2][1]) {
        ctx.save()
        ctx.rotate((3 * Math.PI) / 2)
        this.drawElement2(ctx, elementSize, magicNr, borderWidth)
        ctx.restore()
      }
    }

    ctx.restore()
  }

  drawElement0(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    borderWidth: number,
  ) {
    // Round to pixel boundaries and add small overlap to prevent gaps
    const pixelSize = Math.ceil(elementSize) + 0.5
    ctx.fillRect(-0.25, -0.25, pixelSize, pixelSize)
    if (borderWidth > 0) {
      ctx.beginPath()
      ctx.rect(-0.25, -0.25, pixelSize, pixelSize)
      ctx.stroke()
    }
  }

  drawElement1(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    magicNr: number,
    borderWidth: number,
  ) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(elementSize, 0)
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize,
    )
    ctx.closePath()

    ctx.fill()
    if (borderWidth > 0) {
      ctx.stroke()
    }
  }

  drawElement2(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    magicNr: number,
    borderWidth: number,
  ) {
    ctx.beginPath()
    ctx.moveTo(elementSize, 0)
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize,
    )
    ctx.lineTo(elementSize, elementSize)
    ctx.closePath()

    ctx.fill()
    if (borderWidth > 0) {
      ctx.stroke()
    }
  }

  drawElement0BorderOnly(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    borderWidth: number,
  ) {
    // Round to pixel boundaries and add small overlap to prevent gaps
    const pixelSize = Math.ceil(elementSize) + 0.5
    ctx.beginPath()
    ctx.rect(-0.25, -0.25, pixelSize, pixelSize)
    ctx.stroke()
  }

  drawElement1BorderOnly(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    magicNr: number,
    borderWidth: number,
  ) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(elementSize, 0)
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize,
    )
    ctx.closePath()
    ctx.stroke()
  }

  drawElement2BorderOnly(
    ctx: CanvasRenderingContext2D,
    elementSize: number,
    magicNr: number,
    borderWidth: number,
  ) {
    ctx.beginPath()
    ctx.moveTo(elementSize, 0)
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize,
    )
    ctx.lineTo(elementSize, elementSize)
    ctx.closePath()
    ctx.stroke()
  }

  renderBlobOutline(
    ctx: CanvasRenderingContext2D,
    gridSize: number,
    color: string,
    borderWidth: number,
  ) {
    drawActiveLayerOutline(ctx, this, gridSize, color, borderWidth)
  }
}

export const GridPaintCanvas = forwardRef<
  GridPaintCanvasMethods,
  GridPaintCanvasProps
>(({ currentTool, onNameChange, drawingId }, ref) => {
  const $showActiveLayerOutline = useStore(showActiveLayerOutline)
  const canvasView = useStore($canvasView)
  const layersState = useStore($layersState)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { drawingMeta, isReady } = useDrawingState(drawingId)

  const [rasterPoints, setRasterPoints] = useState(
    new Map<string, RasterPoint>(),
  )
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [lastPaintCoords, setLastPaintCoords] = useState<{
    x: number
    y: number
  } | null>(null)

  // Notify parent of name changes
  useEffect(() => {
    onNameChange?.(drawingMeta.name)
  }, [drawingMeta.name, onNameChange])

  const [didInitialize, setDidInitialize] = useState(false)

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

      setRasterPoints(new Map<string, RasterPoint>())
    },
    [didInitialize],
  )

  const getRasterPoint = useCallback(
    (x: number, y: number) => {
      const key = `${x},${y}`
      let point = rasterPoints.get(key)
      if (!point) {
        point = new RasterPoint(x, y)
        rasterPoints.set(key, point)
      }
      return point
    },
    [rasterPoints],
  )

  const updateNeighbors = useCallback(() => {
    rasterPoints.forEach((point) => {
      point.updateNeighbors(layersState.layers, canvasView.gridSize)
    })
  }, [layersState.layers, canvasView.gridSize, rasterPoints])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Disable anti-aliasing for crisp pixel rendering
    ctx.imageSmoothingEnabled = false

    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight

    // Clear canvas
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, displayWidth, displayHeight)

    // Apply zoom and pan transforms
    ctx.save()
    ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
    ctx.scale(canvasView.zoom, canvasView.zoom)

    const { layers, activeLayerId } = layersState
    const { zoom, panOffset, gridSize } = canvasView

    // Calculate visible viewport bounds in grid coordinates
    const viewportMinX = Math.floor(-panOffset.x / (gridSize * zoom)) - 2
    const viewportMaxX =
      Math.ceil((displayWidth - panOffset.x) / (gridSize * zoom)) + 2
    const viewportMinY = Math.floor(-panOffset.y / (gridSize * zoom)) - 2
    const viewportMaxY =
      Math.ceil((displayHeight - panOffset.y) / (gridSize * zoom)) + 2

    // Collect all points that need to be rendered
    const pointsToRender = new Set<string>()

    // Add viewport points
    for (let x = viewportMinX; x <= viewportMaxX; x++) {
      for (let y = viewportMinY; y <= viewportMaxY; y++) {
        pointsToRender.add(`${x},${y}`)
      }
    }

    // Add all active points from all layers
    layers.forEach((layer) => {
      if (layer.isVisible) {
        Array.from(layer.points).forEach((pointKey) => {
          const [x, y] = pointKey.split(",").map(Number)
          // Add the point and its 3x3 neighborhood for proper bridge rendering
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              pointsToRender.add(`${x + dx},${y + dy}`)
            }
          }
        })
      }
    })

    // Create raster points only for points that need rendering
    pointsToRender.forEach((pointKey) => {
      const [x, y] = pointKey.split(",").map(Number)
      getRasterPoint(x, y)
    })

    // Update neighbors with current layer state
    rasterPoints.forEach((point) => {
      point.updateNeighbors(layers, gridSize)
    })

    // Render layers from bottom to top (6 -> 1)
    const sortedLayers = [...layers].sort((a, b) => b.id - a.id)

    // Render each layer with its style
    sortedLayers.forEach((layer) => {
      if (!layer.isVisible) return

      // All layers use grayscale tinting based on depth
      const intensity = Math.max(100, 220 - (layer.id - 1) * 20)
      const color = `rgb(${intensity}, ${intensity}, ${intensity})`

      // Only render points that are in our pointsToRender set
      pointsToRender.forEach((pointKey) => {
        const [x, y] = pointKey.split(",").map(Number)
        const point = rasterPoints.get(pointKey)
        if (!point) return

        // Create a temporary layer state with only this layer's points
        const tempLayers = [
          {
            id: layer.id,
            points: layer.points,
            isVisible: true,
            renderStyle: layer.renderStyle,
          },
        ]

        point.updateNeighbors(tempLayers, gridSize)

        // Check if this point should render anything for this layer
        const isActive = layer.points.has(pointKey)
        const hasActiveNeighbors = point.neighbors.some((row) =>
          row.some((cell) => cell),
        )

        if (isActive || hasActiveNeighbors) {
          if (layer.renderStyle === "tiles") {
            // Render with tiled borders in black
            point.renderBlob(
              ctx,
              gridSize,
              color,
              canvasView.borderWidth,
            )
            point.renderBlobBorderOnly(
              ctx,
              gridSize,
              "#000000",
              canvasView.borderWidth,
            )
          } else {
            // Default style - fill without borders
            point.renderBlob(ctx, gridSize, color, 0)
          }
        }
      })
    })

    // Final pass: render active layer outline on top
    if ($showActiveLayerOutline && activeLayerId !== null) {
      const activeLayer = layers.find((l) => l.id === activeLayerId)
      if (activeLayer && activeLayer.isVisible) {
        pointsToRender.forEach((pointKey) => {
          const [x, y] = pointKey.split(",").map(Number)
          const point = rasterPoints.get(pointKey)
          if (!point) return

          const tempLayers = [
            {
              id: activeLayer.id,
              points: activeLayer.points,
              isVisible: true,
              renderStyle: activeLayer.renderStyle,
            },
          ]

          point.updateNeighbors(tempLayers, gridSize)

          const isActive = activeLayer.points.has(pointKey)
          const hasActiveNeighbors = point.neighbors.some((row) =>
            row.some((cell) => cell),
          )

          if (isActive || hasActiveNeighbors) {
            point.renderBlobOutline(ctx, gridSize, "#000000", 2)
          }
        })
      }
    }

    ctx.restore()
  }, [getRasterPoint, $showActiveLayerOutline, canvasView, layersState])

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
      console.log("rendering")
      render()
    }
  }, [canvasView, layersState, render, isReady])

  // Coordinate conversion and painting utilities
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
      // render() will be triggered automatically by the store update
      return coords
    },
    [getGridCoordinates, currentTool],
  )

  useEffect(() => {
    console.log("rednering canvas")
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseDown = (e: MouseEvent) => {
      setIsDragging(true)

      if (currentTool === "pan") {
        setPanStart({ x: e.clientX, y: e.clientY })
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
  ])

  // Add wheel and touch event listeners for trackpad gestures
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

  useImperativeHandle(ref, () => ({
    reset: () => {
      resetDrawing()
      render()
    },

    setGridSize: (operation: "+" | "-") => {
      const step = 25
      const newSize =
        operation === "+"
          ? Math.min(150, canvasView.gridSize + step)
          : Math.max(25, canvasView.gridSize - step)

      $canvasView.setKey("gridSize", newSize)
      initializeCanvas()
      render()
    },

    setBorderWidth: (width: number) => {
      const clampedWidth = Math.max(0, Math.min(10, width))
      $canvasView.setKey("borderWidth", clampedWidth)
      render()
    },

    saveIMG: () => {
      const canvas = canvasRef.current
      if (!canvas) return

      // Export PNG
      const pngLink = document.createElement("a")
      pngLink.download = `${drawingMeta.name || 'gridpaint'}.png`
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
        exportAllLayersAsSVG(layersState.layers, canvasView.gridSize, canvasView.borderWidth, drawingMeta.name)
      }, 200)
    },

    setActiveLayer: (layerId: number | null) => {
      setActiveLayer(layerId)
      render()
    },

    toggleLayerVisibility: (layerId: number) => {
      toggleLayerVisibility(layerId)
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

      render()
    },

    toggleLayerRenderStyle: (layerId: number) => {
      toggleLayerRenderStyle(layerId)
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
