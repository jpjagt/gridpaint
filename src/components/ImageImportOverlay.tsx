import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { Check, X, RotateCcw, RotateCw, ZoomIn, ZoomOut, ArrowUpDown } from 'lucide-react'
import { $canvasView, $layersState, getLayerPoints, updateLayerPoints, createOrActivateLayer, setActiveLayer } from '@/stores/drawingStores'
import { $imageImport, setOpacity, setTransform, resetImageImport, setPreview, setComputing, noteComputeRequested, setConfig } from '@/stores/imageImport'
import { rasterizeImageToGridLayers } from '@/lib/image/rasterizeToGrid'
import { BlobEngine } from '@/lib/blob-engine/BlobEngine'
import { Canvas2DRenderer } from '@/lib/blob-engine/renderers/Canvas2DRenderer'
import type { GridLayer as BlobGridLayer } from '@/lib/blob-engine/types'
import { ImageCurveEditor } from '@/components/ImageCurveEditor'

// Theme color utility
const getCanvasColor = (varName: string): string => {
  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return hslValue ? `hsl(${hslValue})` : '#000000'
}

export function ImageImportOverlay() {
  const canvasView = useStore($canvasView)
  const imageImport = useStore($imageImport)
  const { layers, activeLayerId } = useStore($layersState)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRendererRef = useRef<Canvas2DRenderer | null>(null)
  const overlayEngineRef = useRef<BlobEngine | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null)

  // Draw overlay contents: engine-rendered preview + semi-transparent image
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pixelRatio = window.devicePixelRatio || 1
    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight
    if (canvas.width !== displayWidth * pixelRatio || canvas.height !== displayHeight * pixelRatio) {
      canvas.width = displayWidth * pixelRatio
      canvas.height = displayHeight * pixelRatio
      canvas.style.width = displayWidth + 'px'
      canvas.style.height = displayHeight + 'px'
      ctx.scale(pixelRatio, pixelRatio)
    }

    ctx.clearRect(0, 0, displayWidth, displayHeight)
    if (!imageImport.isActive) return

    // Init renderer/engine lazily
    if (!overlayRendererRef.current) {
      overlayRendererRef.current = new Canvas2DRenderer(canvas, false)
    } else {
      // Ensure it targets the current canvas (after resize)
      overlayRendererRef.current.setCanvas(canvas)
    }
    if (!overlayEngineRef.current) {
      overlayEngineRef.current = new BlobEngine({ enableCaching: false })
    }

    const renderer = overlayRendererRef.current
    const engine = overlayEngineRef.current

    const { panOffset, zoom, gridSize, borderWidth } = $canvasView.get()

    // Build temporary blob layers from preview sets
    const previewLayers: BlobGridLayer[] = imageImport.preview.map((set, idx) => ({
      id: idx + 1,
      groups: [{ id: "default", points: set }],
      isVisible: true,
      renderStyle: 'default' as const,
    }))

    // Generate composite geometry
    const composite = engine!.generateGeometry(
      previewLayers,
      gridSize,
      borderWidth,
    )

    // Render using blob renderer with current transform and layer colors
    const transform = {
      zoom,
      panOffset,
      viewportWidth: displayWidth,
      viewportHeight: displayHeight,
    }

    const baseStyle = {
      fillColor: '#000000',
      strokeColor: getCanvasColor('--canvas-layer-border'),
      strokeWidth: borderWidth,
      opacity: 1,
    }

    const getLayerStyle = (layerId: number) => {
      const existing = $layersState.get().layers.find(l => l.id === layerId)
      const isTiles = existing?.renderStyle === 'tiles'
      return {
        fillColor: getCanvasColor(`--canvas-layer-${layerId}`),
        strokeColor: isTiles ? getCanvasColor('--canvas-layer-border') : undefined,
        strokeWidth: isTiles ? borderWidth : 0,
        opacity: 1,
      }
    }

    renderer!.renderComposite(
      composite,
      { style: baseStyle, transform },
      getLayerStyle,
    )

    // Draw the semi-transparent image on top (aligned with pan/zoom)
    const img = imageImport.image
    const size = imageImport.imageSize
    if (img && size) {
      ctx.save()
      ctx.translate(panOffset.x, panOffset.y)
      ctx.scale(zoom, zoom)
      ctx.globalAlpha = imageImport.opacity
      ctx.translate(imageImport.transform.cx * gridSize, imageImport.transform.cy * gridSize)
      ctx.rotate((imageImport.transform.rotationDeg * Math.PI) / 180)
      const scale = imageImport.transform.scale * gridSize
      ctx.scale(scale, scale)
      ctx.drawImage(img as CanvasImageSource, -size.width / 2, -size.height / 2)
      ctx.restore()
    }
  }, [canvasView, imageImport])

  // Re-draw on relevant changes
  useEffect(() => {
    drawOverlay()
  }, [drawOverlay])

  // Redraw on window resize
  useEffect(() => {
    const onResize = () => drawOverlay()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [drawOverlay])

  // Compute preview when image, transform, or config changes (throttled)
  useEffect(() => {
    if (!imageImport.isActive || !imageImport.image || !imageImport.imageSize) return

    let cancelled = false
    setComputing(true)
    noteComputeRequested()

    const timeout = setTimeout(() => {
      if (cancelled) return
      try {
        const preview = rasterizeImageToGridLayers({
          image: imageImport.image!,
          imageSize: imageImport.imageSize!,
          transform: imageImport.transform,
          gridSize: canvasView.gridSize,
          config: imageImport.config,
        })
        if (!cancelled) {
          setPreview(preview)
        }
      } catch (err) {
        console.error('Preview rasterization failed', err)
      } finally {
        if (!cancelled) setComputing(false)
        drawOverlay()
      }
    }, 80) // small throttle

    return () => { cancelled = true; clearTimeout(timeout) }
  }, [imageImport.isActive, imageImport.image, imageImport.imageSize, imageImport.transform, imageImport.config, canvasView.gridSize])

  // Pointer handlers for move
  const onPointerDown = (e: React.PointerEvent) => {
    if (!imageImport.isActive) return
    setIsDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragStart.current = { sx: e.clientX, sy: e.clientY, cx: imageImport.transform.cx, cy: imageImport.transform.cy }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStart.current) return
    const { gridSize, zoom } = $canvasView.get()
    const dxPx = e.clientX - dragStart.current.sx
    const dyPx = e.clientY - dragStart.current.sy
    const dxGrid = dxPx / (gridSize * zoom)
    const dyGrid = dyPx / (gridSize * zoom)
    setTransform({ cx: dragStart.current.cx + dxGrid, cy: dragStart.current.cy + dyGrid })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    setIsDragging(false)
    dragStart.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }

  // Wheel: scale; shift+wheel: rotate
  const onWheel = (e: React.WheelEvent) => {
    if (!imageImport.isActive) return
    e.preventDefault()
    const t = $imageImport.get().transform
    if (e.shiftKey) {
      const delta = e.deltaY > 0 ? -2 : 2
      setTransform({ rotationDeg: ((t.rotationDeg + delta) % 360 + 360) % 360 })
    } else {
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(0.005, Math.min(10, t.scale * factor))
      setTransform({ scale: newScale })
    }
  }

  // Commit: ensure six layers exist and merge preview
  const onCommit = () => {
    const currentState = $layersState.get()
    const originalActive = currentState.activeLayerId
    // Ensure layers 1..6 exist
    for (let id = 1; id <= 6; id++) {
      const exists = currentState.layers.some(l => l.id === id)
      if (!exists) {
        createOrActivateLayer(id)
      }
    }
    if (originalActive !== null) setActiveLayer(originalActive)

    // Merge preview points into layers
    const latest = $layersState.get()
    for (let id = 1; id <= 6; id++) {
      const layer = latest.layers.find(l => l.id === id)
      if (!layer) continue
      const merged = new Set<string>(getLayerPoints(layer))
      const previewSet = imageImport.preview[id - 1]
      previewSet.forEach(p => merged.add(p))
      updateLayerPoints(id, merged)
    }

    resetImageImport()
  }

  // Cancel
  const onCancel = () => {
    resetImageImport()
  }

  // Key bindings while active
  useEffect(() => {
    if (!imageImport.isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        onCommit()
      }
      if (e.key === '+' || e.key === '=') {
        const t = $imageImport.get().transform
        setTransform({ scale: Math.min(10, t.scale * 1.1) })
      }
      if (e.key === '-') {
        const t = $imageImport.get().transform
        setTransform({ scale: Math.max(0.005, t.scale / 1.1) })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [imageImport.isActive])

  if (!imageImport.isActive) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-50">
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      {/* Controls */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2 bg-white/70 dark:bg-black/40 backdrop-blur-md rounded-md px-2 py-1 items-center">
        <Button size="icon" variant="ghost" onClick={() => setTransform({ scale: Math.min(10, $imageImport.get().transform.scale * 1.1) })}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setTransform({ scale: Math.max(0.005, $imageImport.get().transform.scale / 1.1) })}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setTransform({ rotationDeg: (($imageImport.get().transform.rotationDeg - 5) % 360 + 360) % 360 })}>
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setTransform({ rotationDeg: (($imageImport.get().transform.rotationDeg + 5) % 360 + 360) % 360 })}>
          <RotateCw className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1 text-xs text-foreground/80">
          <span>opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={imageImport.opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))} />
        </div>
        <Button size="icon" variant="ghost" onClick={() => setConfig({ darkestTop: !imageImport.config.darkestTop })} title="Flip darkest/top mapping">
          <ArrowUpDown className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="default" onClick={onCommit} title="Commit (Enter)">
          <Check className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="destructive" onClick={onCancel} title="Cancel (Esc)">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Curve editor and bins control */}
      <ImageCurveEditor />
    </div>
  )
}
