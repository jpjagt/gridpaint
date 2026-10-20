// === Legacy Types (unused by current system) ===

export interface RasterPoint {
  x: number;
  y: number;
  selected: boolean;
}

export interface GridPaintState {
  gridSize: number;
  gridSizePreset: number;
  gridSizeSteps: number;
  brushColor: string;
  gridElementColor: string;
  bgColor: string;
  rasterPoints: RasterPoint[];
  gridXElements: number;
  gridYElements: number;
}

export interface GridPaintActions {
  reset: () => void;
  setGridSize: (operation: '+' | '-') => void;
  setColor: () => void;
  saveIMG: () => void;
}

// === Quadrant State System ===

/**
 * The 10 possible states for a single quadrant of a point.
 * - full: filled rectangle
 * - empty: nothing rendered
 * - convex-*: convex (outward) curve facing the specified direction
 * - concave-*: concave (inward/bridge) curve facing the specified direction
 */
export type QuadrantState =
  | "full"
  | "empty"
  | "convex-se"
  | "convex-sw"
  | "convex-nw"
  | "convex-ne"
  | "concave-se"
  | "concave-sw"
  | "concave-nw"
  | "concave-ne"

/**
 * Per-quadrant override configuration for a point.
 * Only specified quadrants are overridden; omitted quadrants
 * use the auto-computed value from neighborhood analysis.
 * Quadrant indices: 0=SE, 1=SW, 2=NW, 3=NE
 */
export interface QuadrantOverrides {
  0?: QuadrantState
  1?: QuadrantState
  2?: QuadrantState
  3?: QuadrantState
}

// === Cutouts ===

/** Anchor position for a cutout center relative to the grid point */
export type CutoutAnchor =
  | "nw"
  | "n"
  | "ne"
  | "w"
  | "center"
  | "e"
  | "sw"
  | "s"
  | "se"
  | "custom"

export interface Cutout {
  /** Missing on legacy drawings, which contain circles in millimetres. */
  shape?: "circle" | "pill"
  sizeUnit?: "mm" | "grid"
  diameterGrid?: number
  /** Second circle center relative to the first, in grid units. */
  endOffset?: { x: number; y: number }
  anchor: CutoutAnchor
  /** Used for mm sizing (also the default for legacy cutouts); resolved at render time. */
  diameterMm: number
  /** Optional fine offset from anchor position, in grid units */
  offset?: { x: number; y: number }
  /** Custom anchor position in grid units (used when anchor === "custom") */
  customOffset?: { x: number; y: number }
}

export interface CutoutToolSettings {
  shape: "circle" | "pill"
  anchor: CutoutAnchor
  sizeUnit: "mm" | "grid"
  diameterMm: number
  diameterGrid: number
  customOffset: { x: number; y: number }
  mode: "single" | "rivet"
  rivetScalePercent: number
}

export interface CutoutGeometry {
  start: { x: number; y: number }
  end: { x: number; y: number }
  radius: number
}

export interface CutoutVertex {
  x: number
  y: number
  /** Outgoing semicircle (-1) or straight side (0), in SVG coordinates. */
  bulge: number
}

export interface CutoutDraft {
  point: { x: number; y: number }
  layerId: number
  cutout: Cutout
}

/** Offsets from grid point center for each cutout anchor, in grid units */
export const CUTOUT_ANCHOR_OFFSETS: Record<Exclude<CutoutAnchor, "custom">, { x: number; y: number }> = {
  "nw":     { x: -0.5,  y: -0.5 },
  "n":      { x: 0,     y: -0.5 },
  "ne":     { x: 0.5,   y: -0.5 },
  "w":      { x: -0.5,  y: 0    },
  "center": { x: 0,     y: 0    },
  "e":      { x: 0.5,   y: 0    },
  "sw":     { x: -0.5,  y: 0.5  },
  "s":      { x: 0,     y: 0.5  },
  "se":     { x: 0.5,   y: 0.5  },
}

// === Point Modifications ===

/**
 * Per-point modifications that extend beyond filled/empty.
 * Stored sparsely: only points with modifications have entries.
 */
export interface PointModifications {
  cutouts?: Cutout[]
  quadrantOverrides?: QuadrantOverrides
}

// === Interaction Groups ===

/**
 * An interaction group defines a subset of points on a layer
 * whose blob/neighborhood analysis is computed independently.
 * Points can belong to multiple groups.
 */
export interface InteractionGroup {
  id: string
  name?: string
  points: Set<string> // "x,y" format
  /**
   * Lattice phase for this group along each axis. "half" shifts every point by
   * +0.5 in that dimension at render time (occupying a quadrant boundary).
   * Absent ⇒ "normal". The two axes toggle independently.
   */
  offsetPhaseX?: "normal" | "half"
  offsetPhaseY?: "normal" | "half"
}

// === Export Rects ===

/**
 * A named region of the grid to be included in SVG export.
 * Persisted with the drawing document.
 */
export interface ExportRect {
  /** Unique identifier */
  id: string
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** How many copies to include in the export layout (default 1) */
  quantity: number
  /** Optional label for this rect (used in filenames and the BOM clipboard) */
  name?: string
  /** Optional override for mm per unit. Undefined/0 means use global canvasView.mmPerUnit */
  customMmPerUnit?: number
  /** Optional override for layer thickness in mm. Undefined/0 means use global canvasView.layerThickness */
  customThickness?: number
}

// === Validation ===

export interface ValidationIssue {
  severity: "warning" | "error"
  pointKey: string
  quadrant?: 0 | 1 | 2 | 3
  message: string
}

// === Clipboard / Selection Types ===

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

// === Shape Tool ===

/** Primitive shapes the shape tool can draw */
export type ShapeKind = "rectangle" | "ellipse"

/** fill = every interior cell; edge = single-cell-wide outline */
export type ShapeStyle = "fill" | "edge"

/** Compass id of one of a shape float's 8 resize handles. */
export type ShapeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se"

/**
 * Handle ids in render order (top row L→R, middle L→R, bottom L→R). The renderer
 * and the canvas hit-test must use this same ordering.
 */
export const SHAPE_HANDLE_IDS: ShapeHandle[] = [
  "nw", "n", "ne",
  "w",       "e",
  "sw", "s", "se",
]

/**
 * Metadata carried by a floating paste when it represents a live shape preview.
 * Width/height are in grid cells (>= 1). The float's cell data is derived from
 * these params via rasterizeShape().
 */
export interface ShapeMeta {
  kind: ShapeKind
  style: ShapeStyle
  width: number
  height: number
  /** Superellipse exponent n in |x/a|^n + |y/b|^n <= 1. */
  exponent: number
}