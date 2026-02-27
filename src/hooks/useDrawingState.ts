import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"
import {
  $loadingState,
  $drawingMeta,
  $canvasView,
  $layersState,
  $exportRects,
  initializeDrawingState,
  saveDrawingState,
  type LoadingState,
} from "@/stores/drawingStores"

function useDrawingState(drawingId: string) {
  const loadingState = useStore($loadingState)
  const drawingMeta = useStore($drawingMeta)
  const canvasView = useStore($canvasView)
  const layersState = useStore($layersState)
  const exportRects = useStore($exportRects)
  const initRef = useRef(false)
  const persistenceEnabledRef = useRef(false)

  // Initialize drawing state on mount
  useEffect(() => {
    if (!initRef.current && drawingId) {
      initRef.current = true
      initializeDrawingState(drawingId).then(() => {
        // Enable persistence only after initialization is complete
        persistenceEnabledRef.current = true
      })
    }
  }, [drawingId])

  // Auto-save when ready and persistence is enabled - only watch content changes
  useEffect(() => {
    if (loadingState === "ready" && persistenceEnabledRef.current) {
      const timeoutId = setTimeout(() => {
        saveDrawingState()
      }, 1000) // Debounced save

      return () => clearTimeout(timeoutId)
    }
  }, [loadingState, drawingMeta.name, canvasView, layersState, exportRects])

  return {
    loadingState,
    drawingMeta,
    canvasView,
    layersState,
    isReady: loadingState === "ready",
  }
}

export default useDrawingState
