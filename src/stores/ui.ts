import { atom, map } from 'nanostores'
import type { CutoutAnchor, QuadrantState, SelectionBounds, ClipboardData, ShapeKind, ShapeStyle, ShapeMeta } from '@/types/gridpaint'

// === Tool types ===

export type Tool = "draw" | "erase" | "pan" | "select" | "cutout" | "override" | "measure" | "export" | "shape"

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
  mode: "single" | "rivet"
  rivetScalePercent: number
}

export const $cutoutToolSettings = map<CutoutToolSettings>({
  anchor: "center",
  diameterMm: 2.0,
  customOffset: { x: 0, y: 0 },
  mode: "single",
  rivetScalePercent: 140,
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
  /**
   * When true this float was produced by lifting points off the canvas (move gesture).
   * Cancelling a lifted float restores the points to their original position.
   * When false/absent the float came from a clipboard paste; cancelling discards it.
   */
  lifted?: boolean
  /**
   * When present, this float is a live shape preview. Its `data` cells are
   * derived from these params via rasterizeShape; editing them re-rasterizes.
   */
  shape?: ShapeMeta
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

// === Shape tool settings ===

export interface ShapeToolSettings {
  shape: ShapeKind
  style: ShapeStyle
  /** Superellipse exponent per kind so each remembers its own slider value. */
  rectExponent: number    // default 8 (sharp corners); lower = rounder (min 3)
  ellipseExponent: number // default 2 (true ellipse); 1 = diamond, up to 6 boxy
}

export const $shapeToolSettings = map<ShapeToolSettings>({
  shape: "rectangle",
  style: "fill",
  rectExponent: 8,
  ellipseExponent: 2,
})

/** Pick the active exponent for the currently-selected kind. */
export const activeShapeExponent = (s: ShapeToolSettings): number =>
  s.shape === "rectangle" ? s.rectExponent : s.ellipseExponent

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

// === Center of Gravity ===

export const $showCenterOfGravity = atom<boolean>(false)
