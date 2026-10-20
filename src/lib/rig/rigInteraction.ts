/**
 * Clicks in the assembly rig tool. Pillars: toggle the pillar at the
 * clicked grid point. Glue: remove the placed spot under the cursor, else
 * accept the suggestion under it, else place a spot at the nearest half
 * grid point (for the active layer's interface).
 */

import type { CanvasViewState } from "@/stores/drawingStores"
import { $exportRects, $glueSpots, $layersState } from "@/stores/drawingStores"
import {
  $printSetup,
  $rigAnalysis,
  $rigToolSettings,
  addGlueSpots,
  removeGlueSpot,
  rigRect,
  togglePillar,
} from "@/stores/rigStores"

/** Click radius around a glue spot, in grid units */
const SPOT_HIT = 0.35

export function handleRigClick(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  canvasView: CanvasViewState,
): void {
  const settings = $rigToolSettings.get()
  const rects = $exportRects.get()
  const bounds = canvas.getBoundingClientRect()
  // Grid units in the SVG frame (point (x, y) is centred at (x, y))
  const gx =
    (clientX - bounds.left - canvasView.panOffset.x) / canvasView.zoom / canvasView.gridSize - 0.5
  const gy =
    (clientY - bounds.top - canvasView.panOffset.y) / canvasView.zoom / canvasView.gridSize - 0.5

  // Clicking inside another rect switches the rig to it
  const hit = rects.find(
    (r) => gx >= r.minX - 0.5 && gx <= r.maxX + 0.5 && gy >= r.minY - 0.5 && gy <= r.maxY + 0.5,
  )
  const current = rigRect(rects, settings.rectId)
  if (hit && current && hit.id !== current.id) {
    $rigToolSettings.setKey("rectId", hit.id)
    return
  }
  if (!current) return

  if (settings.mode === "pillars") {
    togglePillar(current.id, Math.round(gx), Math.round(gy))
    return
  }

  const layerId = $layersState.get().activeLayerId
  if (layerId === null) return
  const near = (s: { x: number; y: number }) => Math.hypot(s.x - gx, s.y - gy) <= SPOT_HIT
  const placed = $glueSpots.get().find((s) => s.layerId === layerId && near(s))
  if (placed) {
    removeGlueSpot(placed)
    return
  }
  const suggestion = $rigAnalysis
    .get()
    ?.suggestedGlueSpots.find((s) => s.layerId === layerId && near(s))
  if (suggestion) {
    addGlueSpots([spotFrom(suggestion, $printSetup.get().glueDiameter)])
    return
  }
  addGlueSpots([{ layerId, x: Math.round(gx * 2) / 2, y: Math.round(gy * 2) / 2 }])
}

/** A stored spot from a suggestion; keep a reduced diameter if it has one */
export function spotFrom(s: { layerId: number; x: number; y: number; diameter: number }, defaultDiameter?: number) {
  const spot = { layerId: s.layerId, x: s.x, y: s.y }
  return defaultDiameter !== undefined && s.diameter < defaultDiameter
    ? { ...spot, diameter: s.diameter }
    : spot
}
