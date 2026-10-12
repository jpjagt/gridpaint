/**
 * Types for the generative lab (/#/lab). See lab/docs/architecture.md.
 */

import type { ClipboardLayer, SelectionBounds } from "@/types/gridpaint"

export interface LabGroup {
  id: string
  points: string[] // "x,y"
}

export interface LabLayer {
  id: number
  groups: LabGroup[]
}

export interface LabFrame {
  label: string
  layers: LabLayer[]
}

/** gridlab-design JSON (v1) */
export interface LabDesign {
  type: "gridlab-design"
  version: number
  id: string
  title: string
  recipe: string
  params: Record<string, unknown>
  seed: number | null
  tags: string[]
  notes?: string
  width: number
  height: number
  layers: LabLayer[]
  frames?: LabFrame[]
}

export interface LabSection {
  id: string
  title: string
  description?: string
  designs: LabDesign[]
}

export interface LabGallery {
  type: "gridlab-gallery"
  version: number
  generatedAt?: string
  sections: LabSection[]
}

export type LabPaletteMode = "jewel" | "theme"

/** Colours resolved once (theme mode reads CSS vars). */
export interface LabPalette {
  mode: LabPaletteMode
  background: string
  /** Fill colour for a layer, given its id and its rank from the top among the design's layers. */
  colorFor: (layerId: number, rank: number, layerCount: number) => string
}

export interface LabRenderOptions {
  /** Size of one grid cell in CSS px. Ignored when `fit` is given. */
  cellPx?: number
  /** Fit the design into a fixed CSS-px box (canvas gets this size, design centred). */
  fit?: { width: number; height: number }
  /** Padding in CSS px around the design. */
  padding: number
  /** Restrict to these layer ids (default: all). */
  layerIds?: number[]
  /** Render a frame instead of the final layers (index into design.frames). */
  frameIndex?: number
  palette: LabPalette
  /** Device pixel ratio (default window.devicePixelRatio). */
  dpr?: number
}

export type LabThumbSize = "S" | "M" | "L"

export type LabParamType = "int" | "float" | "bool" | "choice" | "str" | string

export interface LabParamSpec {
  default: unknown
  min?: number
  max?: number
  step?: number
  choices?: unknown[]
  type?: LabParamType
}

export interface LabRecipe {
  name: string
  section?: string
  title?: string
  description?: string
  params: Record<string, LabParamSpec>
}

/** gridpaint-selection clipboard payload (editor interop). */
export interface GridpaintSelectionPayload {
  type: "gridpaint-selection"
  version: string
  data: {
    layers: ClipboardLayer[]
    bounds: SelectionBounds
    timestamp: number
  }
}

/** A design shown on the board, with the section it came from. */
export interface LabBoardItem {
  key: string
  sectionId: string
  design: LabDesign
}
