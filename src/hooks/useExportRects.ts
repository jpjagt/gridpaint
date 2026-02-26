/**
 * Hook for managing export rectangle interactions.
 *
 * Mirrors the useSelection drag pattern:
 *  - drawStart / drawEnd track the current in-progress drag in local state
 *  - On mouseup the rect is committed to the $exportRects atom
 *  - Click on an existing rect selects it (for deletion via Delete key)
 */

import { useState, useCallback } from "react"
import { $exportRects } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

/** Generate a simple unique id */
const newId = () => `er-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const useExportRects = () => {
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /** Normalise start/end to min/max bounds */
  const getDraftBounds = useCallback(
    (
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => ({
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    }),
    [],
  )

  const startDraw = useCallback(
    (
      clientX: number,
      clientY: number,
      getGridCoordinates: (cx: number, cy: number) => { x: number; y: number } | null,
    ) => {
      const grid = getGridCoordinates(clientX, clientY)
      if (!grid) return
      setDrawStart(grid)
      setDrawEnd(grid)
      // Deselect when starting a new draw
      setSelectedId(null)
    },
    [],
  )

  const updateDraw = useCallback(
    (
      clientX: number,
      clientY: number,
      getGridCoordinates: (cx: number, cy: number) => { x: number; y: number } | null,
    ) => {
      if (!drawStart) return
      const grid = getGridCoordinates(clientX, clientY)
      if (!grid) return
      setDrawEnd(grid)
    },
    [drawStart],
  )

  const commitDraw = useCallback(() => {
    if (!drawStart || !drawEnd) return
    const bounds = getDraftBounds(drawStart, drawEnd)
    // Reject if an existing rect has exactly the same bounds
    const duplicate = $exportRects.get().some(
      (r) =>
        r.minX === bounds.minX &&
        r.minY === bounds.minY &&
        r.maxX === bounds.maxX &&
        r.maxY === bounds.maxY,
    )
    if (!duplicate) {
      const newRect: ExportRect = { id: newId(), ...bounds, quantity: 1 }
      $exportRects.set([...$exportRects.get(), newRect])
    }
    setDrawStart(null)
    setDrawEnd(null)
  }, [drawStart, drawEnd, getDraftBounds])

  const cancelDraw = useCallback(() => {
    setDrawStart(null)
    setDrawEnd(null)
  }, [])

  /** Select an existing rect by id (for deletion). Pass null to deselect. */
  const selectRect = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  /** Delete the currently selected rect */
  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    $exportRects.set($exportRects.get().filter((r) => r.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  /** Delete a specific rect by id */
  const deleteById = useCallback((id: string) => {
    $exportRects.set($exportRects.get().filter((r) => r.id !== id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }, [])

  /** Return the first rect that contains the given grid coordinate, or null */
  const getHitRect = useCallback(
    (gridX: number, gridY: number): ExportRect | null => {
      return (
        $exportRects.get().find(
          (r) => gridX >= r.minX && gridX <= r.maxX && gridY >= r.minY && gridY <= r.maxY,
        ) ?? null
      )
    },
    [],
  )

  /** Update the quantity of a specific rect */
  const setQuantity = useCallback((id: string, quantity: number) => {
    $exportRects.set(
      $exportRects.get().map((r) => (r.id === id ? { ...r, quantity } : r)),
    )
  }, [])

  /** Remove all export rects */
  const clearAll = useCallback(() => {
    $exportRects.set([])
    setSelectedId(null)
    setDrawStart(null)
    setDrawEnd(null)
  }, [])

  const draftBounds =
    drawStart && drawEnd ? getDraftBounds(drawStart, drawEnd) : null

  return {
    draftBounds,
    isDrawing: drawStart !== null,
    selectedId,
    startDraw,
    updateDraw,
    commitDraw,
    cancelDraw,
    selectRect,
    deleteSelected,
    deleteById,
    getHitRect,
    setQuantity,
    clearAll,
  }
}
