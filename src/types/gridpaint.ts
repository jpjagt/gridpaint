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

// === Circular Cutouts ===

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

export interface CircularCutout {
  anchor: CutoutAnchor
  /** Diameter in millimetres (primary/leading value; converted to grid units via mmPerUnit at render time) */
  diameterMm: number
  /** Optional fine offset from anchor position, in grid units */
  offset?: { x: number; y: number }
  /** Custom anchor position in grid units (used when anchor === "custom") */
  customOffset?: { x: number; y: number }
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
  cutouts?: CircularCutout[]
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
}

// === Validation ===

export interface ValidationIssue {
  severity: "warning" | "error"
  pointKey: string
  quadrant?: 0 | 1 | 2 | 3
  message: string
}