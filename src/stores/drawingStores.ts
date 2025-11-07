import { atom, map } from "nanostores"
import { drawingStore } from "@/lib/storage/store"
import type { DrawingDocument, LayerData } from "@/lib/storage/types"
import { DEFAULT_MM_PER_UNIT } from "@/lib/constants"

export interface Layer {
  id: number
  points: Set<string>
  isVisible: boolean
  renderStyle: "default" | "tiles"
}

export interface CanvasViewState {
  gridSize: number
  borderWidth: number
  panOffset: { x: number; y: number }
  zoom: number
  mmPerUnit: number // How many millimeters each grid unit represents
}

export interface LayersState {
  layers: Layer[]
  activeLayerId: number | null
}

export interface DrawingMetaState {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type LoadingState = "loading" | "ready" | "error"

// Core stores
export const $loadingState = atom<LoadingState>("loading")
export const $drawingMeta = map<DrawingMetaState>({
  id: "",
  name: "",
  createdAt: 0,
  updatedAt: 0,
})

export const $canvasView = map<CanvasViewState>({
  gridSize: 75,
  borderWidth: 0.5,
  panOffset: { x: 0, y: 0 },
  zoom: 1,
  mmPerUnit: DEFAULT_MM_PER_UNIT,
})

export const $layersState = map<LayersState>({
  layers: [],
  activeLayerId: null,
})

// Helper functions
export function createDefaultLayer(id: number = 1): Layer {
  return {
    id,
    points: new Set<string>(),
    isVisible: true,
    renderStyle: "default",
  }
}

// State management functions
export async function initializeDrawingState(drawingId: string): Promise<void> {
  $loadingState.set("loading")

  try {
    const stored = await drawingStore.get(drawingId)

    if (stored) {
      // Load from storage
      $drawingMeta.set({
        id: stored.id,
        name: stored.name,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })

      $canvasView.set({
        gridSize: stored.gridSize,
        borderWidth: stored.borderWidth,
        panOffset: stored.panOffset,
        zoom: stored.zoom,
        mmPerUnit: stored.mmPerUnit || DEFAULT_MM_PER_UNIT, // Default for legacy drawings
      })

      $layersState.set({
        layers: stored.layers,
        activeLayerId: stored.layers.length > 0 ? stored.layers[0].id : null,
      })
    } else {
      // Create new drawing
      const now = Date.now()
      const defaultLayer = createDefaultLayer(1)

      $drawingMeta.set({
        id: drawingId,
        name: "Untitled",
        createdAt: now,
        updatedAt: now,
      })

      $canvasView.set({
        gridSize: 75,
        borderWidth: 0.5,
        panOffset: { x: 0, y: 0 },
        zoom: 1,
        mmPerUnit: DEFAULT_MM_PER_UNIT,
      })

      $layersState.set({
        layers: [defaultLayer],
        activeLayerId: defaultLayer.id,
      })
    }

    $loadingState.set("ready")
  } catch (error) {
    console.error("Failed to initialize drawing state:", error)
    $loadingState.set("error")
  }
}

export async function saveDrawingState(): Promise<void> {
  const meta = $drawingMeta.get()
  const canvasView = $canvasView.get()
  const layersState = $layersState.get()

  if (!meta.id) return

  const document: DrawingDocument = {
    ...meta,
    ...canvasView,
    layers: layersState.layers,
    updatedAt: Date.now(),
  }

  try {
    await drawingStore.save(document)
    $drawingMeta.setKey("updatedAt", document.updatedAt)
  } catch (error) {
    console.error("Failed to save drawing:", error)
  }
}

// Layer management functions
export function addLayer(): void {
  const current = $layersState.get()
  const newId = Math.max(...current.layers.map((l) => l.id), 0) + 1
  const newLayer = createDefaultLayer(newId)

  $layersState.set({
    layers: [...current.layers, newLayer],
    activeLayerId: newId,
  })
}

export function setActiveLayer(layerId: number | null): void {
  $layersState.setKey("activeLayerId", layerId)
}

export function toggleLayerVisibility(layerId: number): void {
  const current = $layersState.get()
  const layers = current.layers.map((layer) =>
    layer.id === layerId ? { ...layer, isVisible: !layer.isVisible } : layer,
  )
  $layersState.setKey("layers", layers)
}

export function toggleLayerRenderStyle(layerId: number): void {
  const current = $layersState.get()
  const layers = current.layers.map((layer) =>
    layer.id === layerId
      ? {
          ...layer,
          renderStyle: (layer.renderStyle === "default"
            ? "tiles"
            : "default") as Layer["renderStyle"],
        }
      : layer,
  )
  $layersState.setKey("layers", layers)
}

export function createOrActivateLayer(layerId: number): void {
  const current = $layersState.get()
  const existingLayer = current.layers.find((l) => l.id === layerId)

  if (existingLayer) {
    setActiveLayer(layerId)
  } else {
    const newLayer = createDefaultLayer(layerId)
    $layersState.set({
      layers: [...current.layers, newLayer],
      activeLayerId: layerId,
    })
  }
}

export function updateLayerPoints(layerId: number, points: Set<string>): void {
  const current = $layersState.get()
  const layers = current.layers.map((layer) =>
    layer.id === layerId ? { ...layer, points: new Set(points) } : layer,
  )
  $layersState.setKey("layers", layers)
}

export function resetDrawing(): void {
  const defaultLayer = createDefaultLayer(1)
  $layersState.set({
    layers: [defaultLayer],
    activeLayerId: defaultLayer.id,
  })

  $canvasView.set({
    gridSize: 20,
    borderWidth: 0.5,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: DEFAULT_MM_PER_UNIT,
  })
}
