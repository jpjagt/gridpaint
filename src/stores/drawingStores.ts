import { atom, map } from "nanostores"
import { drawingStore } from "@/lib/storage/store"
import type { DrawingDocument, LayerData } from "@/lib/storage/types"
import { DEFAULT_MM_PER_UNIT } from "@/lib/constants"
import type { InteractionGroup, PointModifications } from "@/types/gridpaint"
import { pushHistory, clearHistory } from "@/stores/historyStore"

export interface Layer {
  id: number
  isVisible: boolean
  renderStyle: "default" | "tiles"
  /** Interaction groups. All points live inside groups. */
  groups: InteractionGroup[]
  /** Per-point modifications keyed by "x,y". Only points with mods need entries. */
  pointModifications?: Map<string, PointModifications>
}

/** Derive the union of all points across all groups in a layer */
export function getLayerPoints(layer: Layer): Set<string> {
  const all = new Set<string>()
  for (const group of layer.groups) {
    for (const p of group.points) all.add(p)
  }
  return all
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
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "default", points: new Set<string>() }],
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

    clearHistory()
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
  pushHistory(current.layers)
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
  pushHistory(current.layers)
  const layers = current.layers.map((layer) =>
    layer.id === layerId ? { ...layer, isVisible: !layer.isVisible } : layer,
  )
  $layersState.setKey("layers", layers)
}

export function toggleLayerRenderStyle(layerId: number): void {
  const current = $layersState.get()
  pushHistory(current.layers)
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
    pushHistory(current.layers)
    const newLayer = createDefaultLayer(layerId)
    $layersState.set({
      layers: [...current.layers, newLayer],
      activeLayerId: layerId,
    })
  }
}

/**
 * Update points for a specific group on a layer.
 * If groupId is omitted, updates the first group (default).
 */
export function updateGroupPoints(
  layerId: number,
  points: Set<string>,
  groupId?: string,
): void {
  const current = $layersState.get()
  const layers = current.layers.map((layer) => {
    if (layer.id !== layerId) return layer
    const targetGroupId = groupId ?? layer.groups[0]?.id ?? "default"
    const groups = layer.groups.map((g) =>
      g.id === targetGroupId ? { ...g, points: new Set(points) } : g,
    )
    return { ...layer, groups }
  })
  $layersState.setKey("layers", layers)
}

/**
 * Convenience: update points for the first/default group of a layer.
 * Most drawing operations use this.
 */
export function updateLayerPoints(layerId: number, points: Set<string>): void {
  updateGroupPoints(layerId, points)
}

/**
 * Add a new interaction group to the active layer.
 * Returns the new group's id, or null if no active layer.
 */
export function addGroupToActiveLayer(): string | null {
  const current = $layersState.get()
  if (current.activeLayerId === null) return null

  const layers = current.layers.map((layer) => {
    if (layer.id !== current.activeLayerId) return layer
    const newGroupId = `group-${layer.groups.length + 1}`
    const newGroup: InteractionGroup = {
      id: newGroupId,
      points: new Set<string>(),
    }
    return { ...layer, groups: [...layer.groups, newGroup] }
  })
  $layersState.setKey("layers", layers)

  const updatedLayer = layers.find((l) => l.id === current.activeLayerId)
  return updatedLayer ? updatedLayer.groups[updatedLayer.groups.length - 1].id : null
}

/**
 * Remove empty trailing groups from the active layer, keeping at least one group.
 * Groups that are after the given keepUpToIndex are removed if empty.
 * Returns the number of groups remaining.
 */
export function collapseEmptyTrailingGroups(keepUpToIndex: number): number {
  const current = $layersState.get()
  if (current.activeLayerId === null) return 0

  let resultCount = 0
  const layers = current.layers.map((layer) => {
    if (layer.id !== current.activeLayerId) return layer

    // Find the last non-empty group index
    let lastNonEmptyIdx = 0
    for (let i = 0; i < layer.groups.length; i++) {
      if (layer.groups[i].points.size > 0) {
        lastNonEmptyIdx = i
      }
    }

    // Keep groups up to max(lastNonEmptyIdx, keepUpToIndex), minimum 1 group
    const keepCount = Math.max(lastNonEmptyIdx + 1, Math.min(keepUpToIndex + 1, layer.groups.length))
    const trimmedGroups = layer.groups.slice(0, Math.max(1, keepCount))
    resultCount = trimmedGroups.length
    return { ...layer, groups: trimmedGroups }
  })
  $layersState.setKey("layers", layers)
  return resultCount
}

/**
 * Update point modifications for a specific point on a layer.
 */
export function updatePointModifications(
  layerId: number,
  pointKey: string,
  mods: PointModifications | undefined,
): void {
  const current = $layersState.get()
  const layers = current.layers.map((layer) => {
    if (layer.id !== layerId) return layer
    const newMods = new Map(layer.pointModifications || [])
    if (mods === undefined) {
      newMods.delete(pointKey)
    } else {
      newMods.set(pointKey, mods)
    }
    return { ...layer, pointModifications: newMods.size > 0 ? newMods : undefined }
  })
  $layersState.setKey("layers", layers)
}

/**
 * Clear all modifications (overrides, cutouts) for a specific point.
 */
export function clearPointModifications(layerId: number, pointKey: string): void {
  updatePointModifications(layerId, pointKey, undefined)
}

export function resetDrawing(): void {
  pushHistory($layersState.get().layers)
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
