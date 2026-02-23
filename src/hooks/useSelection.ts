import { useState, useCallback } from "react"
import { toast } from "sonner"
import { useStore } from "@nanostores/react"
import { $layersState, updateGroupPoints, updatePointModifications } from "@/stores/drawingStores"
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
      }
    },
    [],
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
      }
    },
    [],
  )

  const clearSelection = useCallback(() => {
    setSelectionStart(null)
    setSelectionEnd(null)
  }, [])

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

    // Copy points from all layers, preserving group structure and modifications
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

      // Copy point modifications for points within the selection, with relative keys
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

    // Create JSON payload with schema identifier
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

      let clipboardDataToPaste: ClipboardData | null = null

      // Try to get data from system clipboard first
      const clipboardText = await navigator.clipboard.readText()
      const parsed = JSON.parse(clipboardText)

      // Check if it's a valid gridpaint selection
      if (
        parsed.type === "gridpaint-selection" &&
        parsed.data
      ) {
        clipboardDataToPaste = {
          layers: parsed.data.layers,
          bounds: parsed.data.bounds,
        }
      }

      if (!clipboardDataToPaste) {
        toast.error("Nothing to paste")
        return
      }

      let totalPointsPasted = 0

      // Paste to each layer that has data, preserving group structure and modifications
      clipboardDataToPaste.layers.forEach(({ layerId, groups, pointModifications }) => {
        const layer = layersState.layers.find((l) => l.id === layerId)
        if (!layer) return

        groups.forEach((clipGroup) => {
          // Find matching group by id, or fall back to first group
          const targetGroup = layer.groups.find((g) => g.id === clipGroup.id) ?? layer.groups[0]
          if (!targetGroup) return

          const newPoints = new Set<string>(targetGroup.points)

          clipGroup.points.forEach((relativeKey: string) => {
            const [relativeX, relativeY] = relativeKey.split(",").map(Number)
            const absKey = `${targetGrid.x + relativeX},${targetGrid.y + relativeY}`
            newPoints.add(absKey)
            totalPointsPasted++
          })

          updateGroupPoints(layerId, newPoints, targetGroup.id)
        })

        // Restore point modifications with shifted keys
        if (pointModifications) {
          Object.entries(pointModifications).forEach(([relativeKey, mod]) => {
            const [relativeX, relativeY] = relativeKey.split(",").map(Number)
            const absKey = `${targetGrid.x + relativeX},${targetGrid.y + relativeY}`
            updatePointModifications(layerId, absKey, mod)
          })
        }
      })

      toast.success(`Pasted ${totalPointsPasted} points`)
    },
    [layersState.layers],
  )

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
        return deletedFromThisLayer
      }

      if (deleteFromAllLayers) {
        layersState.layers.forEach((layer) => {
          if (deleteFromLayer(layer) > 0) layersAffected++
        })

        toast.success(
          `Deleted ${totalPointsDeleted} points from ${layersAffected} layers`,
        )
      } else {
        // Delete from active layer only
        const activeLayer = layersState.layers.find(
          (l) => l.id === layersState.activeLayerId,
        )
        if (!activeLayer) {
          toast.error("No active layer selected")
          return
        }

        deleteFromLayer(activeLayer)

        if (totalPointsDeleted > 0) {
          toast.success(
            `Deleted ${totalPointsDeleted} points from layer ${activeLayer.id}`,
          )
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

    // Helper for checking if we have a selection
    hasSelection: !!(selectionStart && selectionEnd),
  }
}
