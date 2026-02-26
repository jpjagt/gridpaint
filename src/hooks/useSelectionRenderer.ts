import { useCallback } from "react"
import type { Canvas2DRenderer } from "@/lib/blob-engine/renderers/Canvas2DRenderer"
import type { FloatingPaste } from "@/stores/ui"
import { renderDashedRect } from "@/lib/gridpaint/renderDashedRect"

// Theme color utility
const getCanvasColor = (varName: string): string => {
  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return hslValue ? `hsl(${hslValue})` : "#000000"
}

export const useSelectionRenderer = () => {
  const renderSelectionRectangle = useCallback((
    renderer: Canvas2DRenderer,
    selectionStart: { x: number, y: number },
    selectionEnd: { x: number, y: number },
    canvasView: { zoom: number, panOffset: { x: number, y: number }, gridSize: number }
  ) => {
    if (!renderer.context) return

    const ctx = renderer.context
    ctx.save()
    ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
    ctx.scale(canvasView.zoom, canvasView.zoom)

    const minX = Math.min(selectionStart.x, selectionEnd.x)
    const minY = Math.min(selectionStart.y, selectionEnd.y)
    const maxX = Math.max(selectionStart.x, selectionEnd.x)
    const maxY = Math.max(selectionStart.y, selectionEnd.y)

    renderDashedRect(
      ctx,
      minX * canvasView.gridSize,
      minY * canvasView.gridSize,
      (maxX - minX + 1) * canvasView.gridSize,
      (maxY - minY + 1) * canvasView.gridSize,
      getCanvasColor("--canvas-outline-active"),
      canvasView.zoom,
    )

    ctx.restore()
  }, [])

  /**
   * Render a floating paste overlay: each point is drawn as a semi-transparent
   * filled square in the layer's theme color, with a dashed bounding rectangle.
   */
  const renderFloatingPaste = useCallback((
    renderer: Canvas2DRenderer,
    floatingPaste: FloatingPaste,
    canvasView: { zoom: number, panOffset: { x: number, y: number }, gridSize: number }
  ) => {
    if (!renderer.context) return

    const ctx = renderer.context
    const { data, origin, offset } = floatingPaste
    const baseX = origin.x + offset.x
    const baseY = origin.y + offset.y

    ctx.save()
    ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
    ctx.scale(canvasView.zoom, canvasView.zoom)

    const gs = canvasView.gridSize

    // Track bounding box of all drawn points for the dashed outline
    let boundsMinX = Infinity, boundsMinY = Infinity
    let boundsMaxX = -Infinity, boundsMaxY = -Infinity

    data.layers.forEach(({ layerId, groups }) => {
      const layerColor = getCanvasColor(`--canvas-layer-${layerId}`)

      groups.forEach(({ points }) => {
        points.forEach((relKey) => {
          const [rx, ry] = relKey.split(",").map(Number)
          const ax = baseX + rx
          const ay = baseY + ry

          if (ax < boundsMinX) boundsMinX = ax
          if (ay < boundsMinY) boundsMinY = ay
          if (ax > boundsMaxX) boundsMaxX = ax
          if (ay > boundsMaxY) boundsMaxY = ay

          ctx.fillStyle = layerColor
          ctx.globalAlpha = 0.45
          ctx.fillRect(ax * gs, ay * gs, gs, gs)
        })
      })
    })

    ctx.globalAlpha = 1

    // Draw dashed bounding rectangle around the floating content
    if (boundsMinX !== Infinity) {
      renderDashedRect(
        ctx,
        boundsMinX * gs,
        boundsMinY * gs,
        (boundsMaxX - boundsMinX + 1) * gs,
        (boundsMaxY - boundsMinY + 1) * gs,
        getCanvasColor("--canvas-outline-active"),
        canvasView.zoom,
        "transparent",
      )
    }

    ctx.restore()
  }, [])

  return { renderSelectionRectangle, renderFloatingPaste }
}
