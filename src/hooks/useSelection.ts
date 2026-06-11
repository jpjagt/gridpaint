import { useState, useCallback } from "react"
import { toast } from "sonner"
import { useStore } from "@nanostores/react"
import { $layersState, updateGroupPoints, updatePointModifications } from "@/stores/drawingStores"
import { $selectionState, $shapeToolSettings, activeShapeExponent } from "@/stores/ui"
import type { SerializedPointModifications } from "@/lib/storage/types"
import { buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"

export type { SelectionBounds, ClipboardGroup, ClipboardLayer, ClipboardData } from "@/types/gridpaint"
import type { SelectionBounds, ClipboardGroup, ClipboardLayer, ClipboardData, ShapeMeta } from "@/types/gridpaint"

/**
 * Parse clipboard text and, if it looks like a gridpaint selection, return the
 * normalized { layers, bounds }. Lenient: accepts the canonical type tag OR any
 * object whose `data` has an array `layers` and a `bounds`. Returns null otherwise.
 */
export function recognizeSelectionPayload(text: string): ClipboardData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null

  const obj = parsed as { type?: unknown; data?: unknown }
  const data = obj.data as { layers?: unknown; bounds?: unknown } | undefined
  if (!data || typeof data !== "object") return null

  const looksRight = Array.isArray(data.layers) && data.bounds != null
  const taggedRight = obj.type === "gridpaint-selection"
  if (!looksRight && !taggedRight) return null
  if (!Array.isArray(data.layers) || data.bounds == null) return null

  return {
    layers: data.layers as ClipboardData["layers"],
    bounds: data.bounds as ClipboardData["bounds"],
  }
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

    // Lifted floats always restore to their original layerId (never retargeted).
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
   * When `subtract` is true, deletes cells instead of adding them (Alt-subtract).
   */
  const bakeFloatingPaste = useCallback((subtract: boolean = false) => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return

    const { data, origin, offset } = fp
    const targetX = origin.x + offset.x
    const targetY = origin.y + offset.y

    let totalPointsPasted = 0

    // Single-layer clipboard pastes retarget onto the active layer (cross-layer
    // duplication). Lifted floats and multi-layer clips keep their original layerId.
    const retargetSingleLayer =
      !fp.lifted && data.layers.length === 1 && layersState.activeLayerId != null
    const resolveLayerId = (clipLayerId: number): number =>
      retargetSingleLayer ? layersState.activeLayerId! : clipLayerId

    data.layers.forEach(({ layerId, groups, pointModifications }) => {
      const targetLayerId = resolveLayerId(layerId)
      const layer = layersState.layers.find((l) => l.id === targetLayerId)
      if (!layer) return

      groups.forEach((clipGroup) => {
        const targetGroup = layer.groups.find((g) => g.id === clipGroup.id) ?? layer.groups[0]
        if (!targetGroup) return

        const newPoints = new Set<string>(targetGroup.points)

        clipGroup.points.forEach((relativeKey: string) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          if (subtract) {
            newPoints.delete(absKey)
          } else {
            newPoints.add(absKey)
            totalPointsPasted++
          }
        })

        updateGroupPoints(targetLayerId, newPoints, targetGroup.id)
      })

      if (pointModifications && !subtract) {
        Object.entries(pointModifications).forEach(([relativeKey, mod]) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          updatePointModifications(targetLayerId, absKey, mod)
        })
      }
    })

    $selectionState.setKey("floatingPaste", null)
    toast.success(subtract ? `Subtracted shape` : `Placed ${totalPointsPasted} points`)
  }, [layersState.layers, layersState.activeLayerId])

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

  // ─── Shape float helpers ──────────────────────────────────────────────────

  /**
   * Create a shape float at a grid origin (top-left), using the current
   * $shapeToolSettings and the given size in cells. Targets the active layer's
   * active group at bake time (single-layer retarget).
   */
  const startShapeFloat = useCallback(
    (origin: { x: number; y: number }, width: number, height: number) => {
      if ($selectionState.get().floatingPaste) bakeFloatingPaste()
      const { activeLayerId, layers } = layersState
      if (activeLayerId == null) return
      const layer = layers.find((l) => l.id === activeLayerId)
      if (!layer) return
      const groupId = layer.groups[0]?.id ?? "default"
      const settings = $shapeToolSettings.get()
      const { shape, style } = settings
      const exponent = activeShapeExponent(settings)
      const w = Math.max(1, Math.round(width))
      const h = Math.max(1, Math.round(height))

      $selectionState.setKey("floatingPaste", {
        data: buildShapeClipboard(shape, style, w, h, exponent, activeLayerId, groupId),
        origin,
        offset: { x: 0, y: 0 },
        shape: { kind: shape, style, width: w, height: h, exponent },
      })
    },
    [bakeFloatingPaste, layersState],
  )

  /**
   * Re-derive the active shape float's cells after a param change (kind, style,
   * size, exponent). Optionally shift the origin (used when dragging NW/N/W
   * handles so the opposite edge stays anchored).
   */
  const rebuildShapeFloat = useCallback(
    (
      patch: Partial<ShapeMeta>,
      originDelta: { x: number; y: number } = { x: 0, y: 0 },
    ) => {
      const fp = $selectionState.get().floatingPaste
      if (!fp || !fp.shape) return
      const next: ShapeMeta = {
        ...fp.shape,
        ...patch,
        width: Math.max(1, Math.round(patch.width ?? fp.shape.width)),
        height: Math.max(1, Math.round(patch.height ?? fp.shape.height)),
      }
      const layerId = fp.data.layers[0]?.layerId ?? 0
      const groupId = fp.data.layers[0]?.groups[0]?.id ?? "default"

      $selectionState.setKey("floatingPaste", {
        ...fp,
        shape: next,
        origin: { x: fp.origin.x + originDelta.x, y: fp.origin.y + originDelta.y },
        data: buildShapeClipboard(
          next.kind,
          next.style,
          next.width,
          next.height,
          next.exponent,
          layerId,
          groupId,
        ),
      })
    },
    [],
  )

  // ─── Copy ─────────────────────────────────────────────────────────────────

  const copySelection = useCallback(async (activeLayerOnly: boolean = false) => {
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

    const layersToCopy = activeLayerOnly
      ? layersState.layers.filter((l) => l.id === layersState.activeLayerId)
      : layersState.layers

    layersToCopy.forEach((layer) => {
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
  }, [selectionStart, selectionEnd, layersState.layers, layersState.activeLayerId])

  // ─── Paste (enters floating state) ────────────────────────────────────────

  /**
   * Begin a floating paste from already-parsed clipboard data at a grid origin.
   * Bakes any pending float first so we don't lose it.
   */
  const pasteData = useCallback(
    (clipboardData: ClipboardData, atGrid: { x: number; y: number }) => {
      if ($selectionState.get().floatingPaste) bakeFloatingPaste()

      let totalPoints = 0
      clipboardData.layers.forEach(({ groups }) => {
        groups.forEach(({ points }) => {
          totalPoints += points.length
        })
      })

      $selectionState.setKey("floatingPaste", {
        data: clipboardData,
        origin: atGrid,
        offset: { x: 0, y: 0 },
      })

      toast.info(
        `Paste ready — use arrow keys to position, Enter to place, Esc to cancel`,
      )
      return totalPoints
    },
    [bakeFloatingPaste],
  )

  const pasteSelection = useCallback(
    async (
      clientX: number,
      clientY: number,
      getGridCoordinates: (
        clientX: number,
        clientY: number,
      ) => { x: number; y: number } | null,
    ) => {
      const targetGrid = getGridCoordinates(clientX, clientY)
      if (!targetGrid) return

      let clipboardText: string
      try {
        clipboardText = await navigator.clipboard.readText()
      } catch (error) {
        console.error("Failed to read clipboard:", error)
        toast.error("Failed to read clipboard")
        return
      }

      const clipboardData = recognizeSelectionPayload(clipboardText)
      if (!clipboardData) {
        toast.error("Nothing to paste")
        return
      }

      pasteData(clipboardData, targetGrid)
    },
    [pasteData],
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
    pasteData,
    deleteSelection,

    // Lift selection into floating paste
    liftSelection,

    // Drag-to-move helpers
    isInsideSelection,

    // Floating paste
    bakeFloatingPaste,
    cancelFloatingPaste,
    moveFloatingPaste,
    startShapeFloat,
    rebuildShapeFloat,

    // Helper for checking if we have a selection
    hasSelection: !!(selectionStart && selectionEnd),
  }
}
