import { useState, useCallback } from "react"
import { toast } from "sonner"
import { useStore } from "@nanostores/react"
import { $layersState, updateLayerPoints } from "@/stores/drawingStores"

export interface SelectionBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ClipboardData {
  layers: { layerId: number; points: string[] }[]
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

    // Copy points from all layers
    layersState.layers.forEach((layer) => {
      const layerPoints = new Set<string>()

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const pointKey = `${x},${y}`
          if (layer.points.has(pointKey)) {
            // Store relative coordinates
            const relativeKey = `${x - minX},${y - minY}`
            layerPoints.add(relativeKey)
            totalPointsCopied++
          }
        }
      }

      if (layerPoints.size > 0) {
        clipboardData.layers.push({
          layerId: layer.id,
          points: Array.from(layerPoints), // Convert Set to Array for JSON
        })
      }
    })

    // Create JSON payload with schema identifier
    const jsonPayload = {
      type: "gridpaint-selection",
      version: "1.0.0",
      data: {
        layers: clipboardData.layers.map((layer) => ({
          layerId: layer.layerId,
          points: layer.points,
        })),
        bounds: clipboardData.bounds,
        timestamp: Date.now(),
      },
    }

    try {
      // Copy to system clipboard
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
        parsed.version === "1.0.0" &&
        parsed.data
      ) {
        clipboardDataToPaste = {
          layers: parsed.data.layers.map((layer: any) => ({
            layerId: layer.layerId,
            points: new Set(layer.points),
          })),
          bounds: parsed.data.bounds,
        }
      }

      if (!clipboardDataToPaste) {
        toast.error("Nothing to paste")
        return
      }

      let totalPointsPasted = 0

      // Paste to each layer that has data
      clipboardDataToPaste.layers.forEach(({ layerId, points }) => {
        const layer = layersState.layers.find((l) => l.id === layerId)
        if (!layer) return

        const newPoints = new Set(layer.points)

        points.forEach((relativePointKey) => {
          const [relativeX, relativeY] = relativePointKey.split(",").map(Number)
          const absoluteX = targetGrid.x + relativeX
          const absoluteY = targetGrid.y + relativeY
          const absoluteKey = `${absoluteX},${absoluteY}`

          newPoints.add(absoluteKey)
          totalPointsPasted++
        })

        updateLayerPoints(layerId, newPoints)
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

      if (deleteFromAllLayers) {
        // Delete from all layers
        layersState.layers.forEach((layer) => {
          const newPoints = new Set(layer.points)
          let deletedFromThisLayer = 0

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

          if (deletedFromThisLayer > 0) {
            updateLayerPoints(layer.id, newPoints)
            layersAffected++
          }
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

        const newPoints = new Set(activeLayer.points)

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const pointKey = `${x},${y}`
            if (newPoints.has(pointKey)) {
              newPoints.delete(pointKey)
              totalPointsDeleted++
            }
          }
        }

        if (totalPointsDeleted > 0) {
          updateLayerPoints(activeLayer.id, newPoints)
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
