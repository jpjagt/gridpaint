import { useCallback } from "react"
import type { Canvas2DRenderer } from "@/lib/blob-engine/renderers/Canvas2DRenderer"

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

    // selectionStart and selectionEnd are already in grid coordinates
    const minX = Math.min(selectionStart.x, selectionEnd.x)
    const minY = Math.min(selectionStart.y, selectionEnd.y)
    const maxX = Math.max(selectionStart.x, selectionEnd.x)
    const maxY = Math.max(selectionStart.y, selectionEnd.y)

    // Draw selection rectangle
    ctx.strokeStyle = getCanvasColor("--canvas-outline-active")
    ctx.lineWidth = 2 / canvasView.zoom
    ctx.setLineDash([5 / canvasView.zoom, 5 / canvasView.zoom])

    const rectX = minX * canvasView.gridSize
    const rectY = minY * canvasView.gridSize
    const rectWidth = (maxX - minX + 1) * canvasView.gridSize
    const rectHeight = (maxY - minY + 1) * canvasView.gridSize

    ctx.strokeRect(rectX, rectY, rectWidth, rectHeight)

    // Fill with semi-transparent black overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)"
    ctx.fillRect(rectX, rectY, rectWidth, rectHeight)

    ctx.setLineDash([]) // Reset line dash
    ctx.restore()
  }, [])

  return { renderSelectionRectangle }
}