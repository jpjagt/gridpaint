import { useStore } from "@nanostores/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  $loadingState,
  $drawingMeta,
  $canvasView,
  $layersState,
  $exportRects,
  $selectedExportRectIds,
  $glueSpots,
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
  const selectedExportRectIds = useStore($selectedExportRectIds)
  const glueSpots = useStore($glueSpots)
  const initRef = useRef(false)
  const persistenceEnabledRef = useRef(false)
  // The global loading store can still read "ready" from the previously open
  // drawing when this hook mounts; only trust it once this instance has loaded.
  const [hasLoaded, setHasLoaded] = useState(false)

  // Initialize drawing state on mount.
  //
  // useLayoutEffect (not useEffect) so that when this hook mounts for a new
  // drawing — e.g. after the key-driven remount that happens when switching
  // drawings — initializeDrawingState() flips the global loadingState store to
  // "loading" before the browser paints. The store may still read "ready" from
  // the previously-open drawing, and a plain useEffect would let the canvas
  // paint that stale state for one frame first.
  useLayoutEffect(() => {
    if (!initRef.current && drawingId) {
      initRef.current = true
      initializeDrawingState(drawingId).then(() => {
        // Enable persistence only after initialization is complete
        persistenceEnabledRef.current = true
        setHasLoaded(true)
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
  }, [loadingState, drawingMeta.name, canvasView, layersState, exportRects, selectedExportRectIds, glueSpots])

  return {
    loadingState,
    drawingMeta,
    canvasView,
    layersState,
    isReady: hasLoaded && loadingState === "ready",
  }
}

export default useDrawingState
