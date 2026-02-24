import { atom, map } from 'nanostores'
import type { CutoutAnchor, QuadrantState } from '@/types/gridpaint'
import type { SelectionBounds } from '@/hooks/useSelection'

// === Tool types ===

export type Tool = "draw" | "erase" | "pan" | "select" | "cutout" | "override"

export const $currentTool = atom<Tool>("draw")

export const setCurrentTool = (tool: Tool) => {
  $currentTool.set(tool)
}

// === Active group tracking ===

/** Index of the currently active group within the active layer (0-based) */
export const $activeGroupIndex = atom<number>(0)

export const setActiveGroupIndex = (index: number) => {
  $activeGroupIndex.set(index)
}

/** Cycle to previous group */
export const prevGroup = () => {
  const current = $activeGroupIndex.get()
  if (current > 0) {
    $activeGroupIndex.set(current - 1)
  }
}

/** Cycle to next group, up to nGroups (which creates a new one) */
export const nextGroup = (currentGroupCount: number) => {
  const current = $activeGroupIndex.get()
  // Allow going up to currentGroupCount (one past last index) to create new
  if (current < currentGroupCount) {
    $activeGroupIndex.set(current + 1)
  }
}

// === Active layer outline ===

export const showActiveLayerOutline = atom<boolean>(true)

export const toggleActiveLayerOutline = () => {
  showActiveLayerOutline.set(!showActiveLayerOutline.get())
}

// === Cutout tool settings ===

export interface CutoutToolSettings {
  anchor: CutoutAnchor
  diameterMm: number // diameter in mm, converted to grid units using mmPerUnit
  customOffset: { x: number; y: number }
}

export const $cutoutToolSettings = map<CutoutToolSettings>({
  anchor: "center",
  diameterMm: 2.0,
  customOffset: { x: 0, y: 0 },
})

// === Selection state ===

export interface SelectionState {
  bounds: SelectionBounds | null
}

/** Reactive selection bounds — written by useSelection, read by controls/export */
export const $selectionState = map<SelectionState>({
  bounds: null,
})

// === Override tool settings ===

export interface OverrideToolSettings {
  shape: QuadrantState
}

export const $overrideToolSettings = map<OverrideToolSettings>({
  shape: "full",
})
