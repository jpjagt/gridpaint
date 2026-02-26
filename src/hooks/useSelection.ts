import { useState, useCallback } from "react"
import { toast } from "sonner"
import { useStore } from "@nanostores/react"
import { $layersState, updateGroupPoints, updatePointModifications } from "@/stores/drawingStores"
import { $selectionState } from "@/stores/ui"
import type { PointModifications } from "@/types/gridpaint"
import type { SerializedPointModifications } from "@/lib/storage/types"

export interface SelectionBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ClipboardGroup {
  id: string
  name?: string
  points: string[] // relative "x,y"
}

export interface ClipboardLayer {
  layerId: number
  groups: ClipboardGroup[]
  /** Point modifications keyed by relative "x,y" */
  pointModifications?: Record<string, SerializedPointModifications>
}

export interface ClipboardData {
  layers: ClipboardLayer[]
  bounds: SelectionBounds
}

export const useSelection = () => {
  const layersState = useStore($layersState)

  const [selectionStart, setSelectionStart] = useState<{
    x: number
    y: number
  } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{
    x: number
    y: number
  } | null>(null)

  // Track drag-to-move state
  const [moveDragStart, setMoveDragStart] = useState<{
    x: number
    y: number
  } | null>(null)

  /** Sync the current start/end pair to the $selectionState store */
  const syncSelectionStore = useCallback(
    (
      start: { x: number; y: number } | null,
      end: { x: number; y: number } | null,
    ) => {
      if (start && end) {
        $selectionState.setKey("bounds", {
          minX: Math.min(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxX: Math.max(start.x, end.x),
          maxY: Math.max(start.y, end.y),
        })
      } else {
        $selectionState.setKey("bounds", null)
      }
    },
    [],
  )

  const startSelection = useCallback(
    (
      clientX: number,
      clientY: number,
      getGridCoordinates: (
        clientX: number,
        clientY: number,
      ) => { x: number; y: number } | null,
    ) => {
      const gridCoords = getGridCoordinates(clientX, clientY)
      if (gridCoords) {
        setSelectionStart(gridCoords)
        setSelectionEnd(gridCoords)
        syncSelectionStore(gridCoords, gridCoords)
      }
    },
    [syncSelectionStore],
  )

  const updateSelection = useCallback(
    (
      clientX: number,
      clientY: number,
      getGridCoordinates: (
        clientX: number,
        clientY: number,
      ) => { x: number; y: number } | null,
    ) => {
      const gridCoords = getGridCoordinates(clientX, clientY)
      if (gridCoords) {
        setSelectionEnd(gridCoords)
        syncSelectionStore(selectionStart, gridCoords)
      }
    },
    [selectionStart, syncSelectionStore],
  )

  const clearSelection = useCallback(() => {
    setSelectionStart(null)
    setSelectionEnd(null)
    $selectionState.setKey("bounds", null)
  }, [])

  // ─── Floating paste helpers ───────────────────────────────────────────────

  const hasFloatingPaste = !!$selectionState.get().floatingPaste

  /**
   * Cancel (discard) a floating paste without baking it.
   */
  const cancelFloatingPaste = useCallback(() => {
    $selectionState.setKey("floatingPaste", null)
  }, [])

  /**
   * Bake the floating paste into the canvas at its current offset.
   */
  const bakeFloatingPaste = useCallback(() => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return

    const { data, origin, offset } = fp
    const targetX = origin.x + offset.x
    const targetY = origin.y + offset.y

    let totalPointsPasted = 0

    data.layers.forEach(({ layerId, groups, pointModifications }) => {
      const layer = layersState.layers.find((l) => l.id === layerId)
      if (!layer) return

      groups.forEach((clipGroup) => {
        const targetGroup = layer.groups.find((g) => g.id === clipGroup.id) ?? layer.groups[0]
        if (!targetGroup) return

        const newPoints = new Set<string>(targetGroup.points)

        clipGroup.points.forEach((relativeKey: string) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          newPoints.add(absKey)
          totalPointsPasted++
        })

        updateGroupPoints(layerId, newPoints, targetGroup.id)
      })

      if (pointModifications) {
        Object.entries(pointModifications).forEach(([relativeKey, mod]) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          updatePointModifications(layerId, absKey, mod)
        })
      }
    })

    $selectionState.setKey("floatingPaste", null)
    toast.success(`Placed ${totalPointsPasted} points`)
  }, [layersState.layers])

  /**
   * Move the floating paste offset by (dx, dy) grid units.
   */
  const moveFloatingPaste = useCallback((dx: number, dy: number) => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return
    $selectionState.setKey("floatingPaste", {
      ...fp,
      offset: { x: fp.offset.x + dx, y: fp.offset.y + dy },
    })
  }, [])

  // ─── Copy ─────────────────────────────────────────────────────────────────

  const copySelection = useCallback(async () => {
    if (!selectionStart || !selectionEnd) {
      toast.error("No selection to copy")
      return
    }

    const minX = Math.min(selectionStart.x, selectionEnd.x)
    const minY = Math.min(selectionStart.y, selectionEnd.y)
    const maxX = Math.max(selectionStart.x, selectionEnd.x)
    const maxY = Math.max(selectionStart.y, selectionEnd.y)

    const clipboardData: ClipboardData = {
      layers: [],
      bounds: { minX, minY, maxX, maxY },
    }

    let totalPointsCopied = 0

    layersState.layers.forEach((layer) => {
      const clipboardGroups: ClipboardGroup[] = []

      layer.groups.forEach((group) => {
        const relativePoints: string[] = []
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const pointKey = `${x},${y}`
            if (group.points.has(pointKey)) {
              relativePoints.push(`${x - minX},${y - minY}`)
              totalPointsCopied++
            }
          }
        }
        if (relativePoints.length > 0) {
          clipboardGroups.push({ id: group.id, name: group.name, points: relativePoints })
        }
      })

      if (clipboardGroups.length === 0) return

      const relativeModifications: Record<string, SerializedPointModifications> = {}
      if (layer.pointModifications) {
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const absKey = `${x},${y}`
            const mod = layer.pointModifications.get(absKey)
            if (mod) {
              relativeModifications[`${x - minX},${y - minY}`] = mod as SerializedPointModifications
            }
          }
        }
      }

      clipboardData.layers.push({
        layerId: layer.id,
        groups: clipboardGroups,
        ...(Object.keys(relativeModifications).length > 0
          ? { pointModifications: relativeModifications }
          : {}),
      })
    })

    const jsonPayload = {
      type: "gridpaint-selection",
      version: "2.0.0",
      data: {
        layers: clipboardData.layers,
        bounds: clipboardData.bounds,
        timestamp: Date.now(),
      },
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonPayload))
      toast.success(
        `Copied ${totalPointsCopied} points from ${clipboardData.layers.length} layers`,
      )
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
      toast.error("Failed to copy selection to clipboard")
    }
  }, [selectionStart, selectionEnd, layersState.layers])

  // ─── Paste (enters floating state) ────────────────────────────────────────

  const pasteSelection = useCallback(
    async (
      clientX: number,
      clientY: number,
      getGridCoordinates: (
        clientX: number,
        clientY: number,
      ) => { x: number; y: number } | null,
    ) => {
      // If there is already a floating paste pending, bake it first before
      // starting a new one so we don't lose it.
      const existing = $selectionState.get().floatingPaste
      if (existing) {
        bakeFloatingPaste()
      }

      const targetGrid = getGridCoordinates(clientX, clientY)
      if (!targetGrid) return

      let clipboardDataToPaste: ClipboardData | null = null

      try {
        const clipboardText = await navigator.clipboard.readText()
        const parsed = JSON.parse(clipboardText)

        if (parsed.type === "gridpaint-selection" && parsed.data) {
          clipboardDataToPaste = {
            layers: parsed.data.layers,
            bounds: parsed.data.bounds,
          }
        }
      } catch (error) {
        console.error("Failed to read clipboard:", error)
        toast.error("Failed to read clipboard")
        return
      }

      if (!clipboardDataToPaste) {
        toast.error("Nothing to paste")
        return
      }

      // Count total points
      let totalPoints = 0
      clipboardDataToPaste.layers.forEach(({ groups }) => {
        groups.forEach(({ points }) => { totalPoints += points.length })
      })

      // Enter floating paste mode — origin is the cursor grid position,
      // offset starts at zero
      $selectionState.setKey("floatingPaste", {
        data: clipboardDataToPaste,
        origin: targetGrid,
        offset: { x: 0, y: 0 },
      })

      toast.info(`Paste ready — use arrow keys to position, Enter to place, Esc to cancel`)
    },
    [bakeFloatingPaste],
  )

  // ─── Delete ───────────────────────────────────────────────────────────────

  const deleteSelection = useCallback(
    (deleteFromAllLayers: boolean = false) => {
      if (!selectionStart || !selectionEnd) {
        toast.error("No selection to delete")
        return
      }

      const minX = Math.min(selectionStart.x, selectionEnd.x)
      const minY = Math.min(selectionStart.y, selectionEnd.y)
      const maxX = Math.max(selectionStart.x, selectionEnd.x)
      const maxY = Math.max(selectionStart.y, selectionEnd.y)

      let totalPointsDeleted = 0
      let layersAffected = 0

      const deleteFromLayer = (layer: (typeof layersState.layers)[number]) => {
        let deletedFromThisLayer = 0
        layer.groups.forEach((group) => {
          const newPoints = new Set<string>(group.points)
          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              const pointKey = `${x},${y}`
              if (newPoints.has(pointKey)) {
                newPoints.delete(pointKey)
                deletedFromThisLayer++
                totalPointsDeleted++
              }
            }
          }
          updateGroupPoints(layer.id, newPoints, group.id)
        })
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const pointKey = `${x},${y}`
            if (layer.pointModifications?.has(pointKey)) {
              updatePointModifications(layer.id, pointKey, undefined)
            }
          }
        }
        return deletedFromThisLayer
      }

      if (deleteFromAllLayers) {
        layersState.layers.forEach((layer) => {
          if (deleteFromLayer(layer) > 0) layersAffected++
        })
        toast.success(`Deleted ${totalPointsDeleted} points from ${layersAffected} layers`)
      } else {
        const activeLayer = layersState.layers.find(
          (l) => l.id === layersState.activeLayerId,
        )
        if (!activeLayer) {
          toast.error("No active layer selected")
          return
        }

        deleteFromLayer(activeLayer)

        if (totalPointsDeleted > 0) {
          toast.success(`Deleted ${totalPointsDeleted} points from layer ${activeLayer.id}`)
        } else {
          toast.info("No points to delete in selection")
        }
      }
    },
    [
      selectionStart,
      selectionEnd,
      layersState.layers,
      layersState.activeLayerId,
    ],
  )

  // ─── Move selection (live points on canvas) ───────────────────────────────

  /**
   * Move all points currently within the selection bounds by (dx, dy) grid units,
   * then shift the selection bounds to follow.
   *
   * @param dx - horizontal grid units
   * @param dy - vertical grid units
   * @param activeLayerOnly - when true only the active layer is moved; default = all layers
   */
  const moveSelection = useCallback(
    (dx: number, dy: number, activeLayerOnly: boolean = false) => {
      if (!selectionStart || !selectionEnd) return

      const minX = Math.min(selectionStart.x, selectionEnd.x)
      const minY = Math.min(selectionStart.y, selectionEnd.y)
      const maxX = Math.max(selectionStart.x, selectionEnd.x)
      const maxY = Math.max(selectionStart.y, selectionEnd.y)

      const moveLayer = (layer: (typeof layersState.layers)[number]) => {
        layer.groups.forEach((group) => {
          // Collect points inside and outside the selection
          const inside: string[] = []
          const outside = new Set<string>()

          group.points.forEach((key) => {
            const [x, y] = key.split(",").map(Number)
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              inside.push(key)
            } else {
              outside.add(key)
            }
          })

          if (inside.length === 0) return

          // Re-add at shifted positions
          inside.forEach((key) => {
            const [x, y] = key.split(",").map(Number)
            outside.add(`${x + dx},${y + dy}`)
          })

          updateGroupPoints(layer.id, outside, group.id)
        })

        // Shift point modifications within the selection
        if (layer.pointModifications) {
          const modsToMove: Array<{ oldKey: string; newKey: string; mod: PointModifications }> = []

          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              const key = `${x},${y}`
              const mod = layer.pointModifications.get(key)
              if (mod) {
                modsToMove.push({ oldKey: key, newKey: `${x + dx},${y + dy}`, mod })
              }
            }
          }

          modsToMove.forEach(({ oldKey, newKey, mod }) => {
            updatePointModifications(layer.id, oldKey, undefined)
            updatePointModifications(layer.id, newKey, mod)
          })
        }
      }

      const layersToMove = activeLayerOnly
        ? layersState.layers.filter((l) => l.id === layersState.activeLayerId)
        : layersState.layers

      layersToMove.forEach(moveLayer)

      // Shift the selection bounds to follow the moved points
      const newStart = { x: selectionStart.x + dx, y: selectionStart.y + dy }
      const newEnd = { x: selectionEnd.x + dx, y: selectionEnd.y + dy }
      setSelectionStart(newStart)
      setSelectionEnd(newEnd)
      syncSelectionStore(newStart, newEnd)
    },
    [
      selectionStart,
      selectionEnd,
      layersState.layers,
      layersState.activeLayerId,
      syncSelectionStore,
    ],
  )

  // ─── Drag-to-move helpers ─────────────────────────────────────────────────

  /**
   * Returns true if the given grid coordinate falls inside the current selection.
   */
  const isInsideSelection = useCallback(
    (gridX: number, gridY: number): boolean => {
      if (!selectionStart || !selectionEnd) return false
      const minX = Math.min(selectionStart.x, selectionEnd.x)
      const minY = Math.min(selectionStart.y, selectionEnd.y)
      const maxX = Math.max(selectionStart.x, selectionEnd.x)
      const maxY = Math.max(selectionStart.y, selectionEnd.y)
      return gridX >= minX && gridX <= maxX && gridY >= minY && gridY <= maxY
    },
    [selectionStart, selectionEnd],
  )

  /**
   * Start a drag-to-move gesture from the given grid position.
   */
  const startMoveDrag = useCallback((gridX: number, gridY: number) => {
    setMoveDragStart({ x: gridX, y: gridY })
  }, [])

  /**
   * Update a drag-to-move gesture. Returns the delta applied (or null if none).
   */
  const updateMoveDrag = useCallback(
    (
      clientX: number,
      clientY: number,
      getGridCoordinates: (cx: number, cy: number) => { x: number; y: number } | null,
      activeLayerOnly: boolean = false,
    ) => {
      if (!moveDragStart) return
      const grid = getGridCoordinates(clientX, clientY)
      if (!grid) return

      const dx = grid.x - moveDragStart.x
      const dy = grid.y - moveDragStart.y
      if (dx === 0 && dy === 0) return

      moveSelection(dx, dy, activeLayerOnly)
      setMoveDragStart(grid)
    },
    [moveDragStart, moveSelection],
  )

  /**
   * End a drag-to-move gesture.
   */
  const endMoveDrag = useCallback(() => {
    setMoveDragStart(null)
  }, [])

  return {
    // Selection state
    selectionStart,
    selectionEnd,

    // Selection actions
    startSelection,
    updateSelection,
    clearSelection,
    copySelection,
    pasteSelection,
    deleteSelection,
    moveSelection,

    // Drag-to-move
    isInsideSelection,
    startMoveDrag,
    updateMoveDrag,
    endMoveDrag,
    isMoveDragging: moveDragStart !== null,

    // Floating paste
    bakeFloatingPaste,
    cancelFloatingPaste,
    moveFloatingPaste,

    // Helper for checking if we have a selection
    hasSelection: !!(selectionStart && selectionEnd),
  }
}
