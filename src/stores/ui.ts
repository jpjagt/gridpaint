import { atom, map } from 'nanostores'
import type { CutoutAnchor, QuadrantState } from '@/types/gridpaint'
import type { SelectionBounds, ClipboardData } from '@/hooks/useSelection'

// === Tool types ===

export type Tool = "draw" | "erase" | "pan" | "select" | "cutout" | "override" | "measure"

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

/** A floating paste payload: clipboard data + current offset from its origin (0,0 = paste origin) */
export interface FloatingPaste {
  /** The clipboard data being positioned */
  data: ClipboardData
  /** Current offset in grid units from the original paste origin */
  offset: { x: number; y: number }
  /** The grid coordinate where the paste was first initiated (used as base for rendering) */
  origin: { x: number; y: number }
}

export interface SelectionState {
  bounds: SelectionBounds | null
  /** When non-null, a paste is "floating" and has not yet been baked into the canvas */
  floatingPaste: FloatingPaste | null
}

/** Reactive selection bounds — written by useSelection, read by controls/export */
export const $selectionState = map<SelectionState>({
  bounds: null,
  floatingPaste: null,
})

// === Override tool settings ===

export interface OverrideToolSettings {
  shape: QuadrantState
}

export const $overrideToolSettings = map<OverrideToolSettings>({
  shape: "full",
})

// === Measure tool state ===

export interface MeasureState {
  /** Screen-pixel start of the current measurement drag, or null when idle */
  start: { x: number; y: number } | null
  /** Screen-pixel end of the current measurement drag (updated live during drag) */
  end: { x: number; y: number } | null
  /** Whether the user is actively dragging */
  isDragging: boolean
}

export const $measureState = map<MeasureState>({
  start: null,
  end: null,
  isDragging: false,
})
