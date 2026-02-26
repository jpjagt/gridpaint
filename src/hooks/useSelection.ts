import { useState, useCallback } from "react"
import { toast } from "sonner"
import { useStore } from "@nanostores/react"
import { $layersState, updateGroupPoints, updatePointModifications } from "@/stores/drawingStores"
import { $selectionState } from "@/stores/ui"
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
   * Cancel a floating paste.
   *
   * - If the float was produced by a lift (move gesture), restore the points to
   *   their original position (origin + zero offset).
   * - If it came from a clipboard paste, simply discard it.
   */
  const cancelFloatingPaste = useCallback(() => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return

    if (fp.lifted) {
      // Restore points back to their original canvas position (origin, offset 0)
      const { data, origin } = fp
      data.layers.forEach(({ layerId, groups, pointModifications }) => {
        const layer = layersState.layers.find((l) => l.id === layerId)
        if (!layer) return

        groups.forEach((clipGroup) => {
          const targetGroup = layer.groups.find((g) => g.id === clipGroup.id) ?? layer.groups[0]
          if (!targetGroup) return

          const newPoints = new Set<string>(targetGroup.points)
          clipGroup.points.forEach((relativeKey: string) => {
            const [rx, ry] = relativeKey.split(",").map(Number)
            newPoints.add(`${origin.x + rx},${origin.y + ry}`)
          })
          updateGroupPoints(layerId, newPoints, targetGroup.id)
        })

        if (pointModifications) {
          Object.entries(pointModifications).forEach(([relativeKey, mod]) => {
            const [rx, ry] = relativeKey.split(",").map(Number)
            updatePointModifications(layerId, `${origin.x + rx},${origin.y + ry}`, mod)
          })
        }
      })
    }

    $selectionState.setKey("floatingPaste", null)
  }, [layersState.layers])

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

  // ─── Lift selection into floating state ──────────────────────────────────

  /**
   * "Lift" the selected points off the canvas into a floating paste overlay.
   *
   * 1. Snapshot all points within the selection bounds (respects activeLayerOnly).
   * 2. Delete those points from the canvas.
   * 3. Build a FloatingPaste at offset {0,0} and store it in $selectionState.
   * 4. Clear the selection bounds so the source ghost is gone.
   *
   * After this call, use moveFloatingPaste / bakeFloatingPaste / cancelFloatingPaste
   * to finish the move.
   *
   * @param activeLayerOnly - when true only lift points from the active layer
   */
  const liftSelection = useCallback(
    (activeLayerOnly: boolean = false) => {
      if (!selectionStart || !selectionEnd) return

      // If already floating, do nothing — the caller should move the existing float
      if ($selectionState.get().floatingPaste) return

      const minX = Math.min(selectionStart.x, selectionEnd.x)
      const minY = Math.min(selectionStart.y, selectionEnd.y)
      const maxX = Math.max(selectionStart.x, selectionEnd.x)
      const maxY = Math.max(selectionStart.y, selectionEnd.y)

      const layersToLift = activeLayerOnly
        ? layersState.layers.filter((l) => l.id === layersState.activeLayerId)
        : layersState.layers

      const clipLayers: ClipboardLayer[] = []

      layersToLift.forEach((layer) => {
        const clipboardGroups: ClipboardGroup[] = []

        layer.groups.forEach((group) => {
          const relativePoints: string[] = []
          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              const pointKey = `${x},${y}`
              if (group.points.has(pointKey)) {
                relativePoints.push(`${x - minX},${y - minY}`)
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

        clipLayers.push({
          layerId: layer.id,
          groups: clipboardGroups,
          ...(Object.keys(relativeModifications).length > 0
            ? { pointModifications: relativeModifications }
            : {}),
        })
      })

      if (clipLayers.length === 0) return // nothing to lift

      // Delete the lifted points from the canvas
      layersToLift.forEach((layer) => {
        layer.groups.forEach((group) => {
          const newPoints = new Set<string>(group.points)
          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              newPoints.delete(`${x},${y}`)
            }
          }
          updateGroupPoints(layer.id, newPoints, group.id)
        })

        // Also remove point modifications in the lifted area
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const key = `${x},${y}`
            if (layer.pointModifications?.has(key)) {
              updatePointModifications(layer.id, key, undefined)
            }
          }
        }
      })

      // Build and store the floating paste (lifted = true so Escape restores)
      $selectionState.setKey("floatingPaste", {
        data: {
          layers: clipLayers,
          bounds: { minX, minY, maxX, maxY },
        },
        origin: { x: minX, y: minY },
        offset: { x: 0, y: 0 },
        lifted: true,
      })

      // Clear the selection bounds
      setSelectionStart(null)
      setSelectionEnd(null)
      $selectionState.setKey("bounds", null)
    },
    [
      selectionStart,
      selectionEnd,
      layersState.layers,
      layersState.activeLayerId,
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

    // Lift selection into floating paste
    liftSelection,

    // Drag-to-move helpers
    isInsideSelection,

    // Floating paste
    bakeFloatingPaste,
    cancelFloatingPaste,
    moveFloatingPaste,

    // Helper for checking if we have a selection
    hasSelection: !!(selectionStart && selectionEnd),
  }
}
