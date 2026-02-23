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
  | "center"
  | "quadrant-se"
  | "quadrant-sw"
  | "quadrant-nw"
  | "quadrant-ne"

export interface CircularCutout {
  anchor: CutoutAnchor
  /** Radius in millimetres (primary/leading value; converted to grid units via mmPerUnit at render time) */
  radiusMm: number
  /** Optional fine offset from anchor position, in grid units */
  offset?: { x: number; y: number }
}

/** Offsets from grid point center for each cutout anchor, in grid units */
export const CUTOUT_ANCHOR_OFFSETS: Record<CutoutAnchor, { x: number; y: number }> = {
  "center":      { x: 0,     y: 0     },
  "quadrant-se": { x: 0.25,  y: 0.25  },
  "quadrant-sw": { x: -0.25, y: 0.25  },
  "quadrant-nw": { x: -0.25, y: -0.25 },
  "quadrant-ne": { x: 0.25,  y: -0.25 },
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

// === Validation ===

export interface ValidationIssue {
  severity: "warning" | "error"
  pointKey: string
  quadrant?: 0 | 1 | 2 | 3
  message: string
}