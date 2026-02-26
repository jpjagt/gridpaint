/**
 * Canvas rendering for export rectangles.
 * Draws each ExportRect as a blue dashed rectangle with a quantity label.
 */

import type { ExportRect } from "@/types/gridpaint"
import { renderDashedRect } from "@/lib/gridpaint/renderDashedRect"

const getCanvasColor = (varName: string): string => {
  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return hslValue ? `hsl(${hslValue})` : "#000000"
}

export function renderExportRects(
  ctx: CanvasRenderingContext2D,
  exportRects: ExportRect[],
  /** The rect currently being drawn (not yet committed), or null */
  draftRect: { minX: number; minY: number; maxX: number; maxY: number } | null,
  canvasView: { zoom: number; panOffset: { x: number; y: number }; gridSize: number },
): void {
  if (exportRects.length === 0 && draftRect === null) return

  ctx.save()
  ctx.translate(canvasView.panOffset.x, canvasView.panOffset.y)
  ctx.scale(canvasView.zoom, canvasView.zoom)

  const exportColor = getCanvasColor("--canvas-outline-export")
  const gs = canvasView.gridSize

  const drawRect = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    alpha = 1,
  ) => {
    ctx.globalAlpha = alpha
    renderDashedRect(
      ctx,
      minX * gs,
      minY * gs,
      (maxX - minX + 1) * gs,
      (maxY - minY + 1) * gs,
      exportColor,
      canvasView.zoom,
      `hsla(210, 100%, 56%, 0.08)`,
    )
    ctx.globalAlpha = 1
  }

  // Draw committed rects with quantity labels
  for (const rect of exportRects) {
    drawRect(rect.minX, rect.minY, rect.maxX, rect.maxY)

    // Quantity label at bottom-right corner (inside the rect)
    if (rect.quantity !== 1) {
      const label = `×${rect.quantity}`
      const fontSize = Math.max(10, 13 / canvasView.zoom)
      ctx.font = `bold ${fontSize}px monospace`
      ctx.fillStyle = exportColor
      ctx.textAlign = "right"
      ctx.textBaseline = "bottom"

      const labelX = (rect.maxX + 1) * gs - 4 / canvasView.zoom
      const labelY = (rect.maxY + 1) * gs - 4 / canvasView.zoom

      ctx.fillText(label, labelX, labelY)
    }
  }

  // Draw draft rect with reduced opacity
  if (draftRect) {
    drawRect(draftRect.minX, draftRect.minY, draftRect.maxX, draftRect.maxY, 0.6)
  }

  ctx.restore()
}
