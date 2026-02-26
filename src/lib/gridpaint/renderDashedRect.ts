/**
 * Shared canvas primitive for drawing a dashed rectangle with optional fill.
 * Used by both the selection renderer and the export-rect renderer so that
 * the visual treatment stays consistent.
 *
 * Caller is responsible for saving/restoring ctx state and applying any
 * pan/zoom transforms before calling this function.
 */
export function renderDashedRect(
  ctx: CanvasRenderingContext2D,
  /** Pixel x of the rect's top-left corner (in world/grid-pixel space) */
  x: number,
  /** Pixel y of the rect's top-left corner */
  y: number,
  width: number,
  height: number,
  strokeColor: string,
  zoom: number,
  /** Optional fill color. Defaults to a semi-transparent black overlay. */
  fillColor: string = "rgba(0, 0, 0, 0.1)",
): void {
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 2 / zoom
  ctx.setLineDash([5 / zoom, 5 / zoom])
  ctx.strokeRect(x, y, width, height)

  ctx.fillStyle = fillColor
  ctx.fillRect(x, y, width, height)

  ctx.setLineDash([])
}
