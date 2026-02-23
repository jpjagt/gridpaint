/**
 * Core type definitions for the GridPaint blob rendering engine
 * Based on the GridPaint Core Drawing Engine Specification
 */

import type { InteractionGroup, PointModifications } from "@/types/gridpaint"

// === Grid Data Model ===

export interface GridPoint {
  x: number
  y: number
}

export interface GridLayer {
  id: number
  /** Interaction groups; all points live inside groups */
  groups: InteractionGroup[]
  isVisible: boolean
  renderStyle: "default" | "tiles"
  /** Per-point modifications keyed by "x,y" */
  pointModifications?: Map<string, PointModifications>
}

/** Derive the union of all points across all groups in a GridLayer */
export function getGridLayerPoints(layer: GridLayer): Set<string> {
  const all = new Set<string>()
  for (const group of layer.groups) {
    for (const p of group.points) all.add(p)
  }
  return all
}

export interface SubgridPoint {
  x: string
  y: string
}

export interface GridDocument {
  layers: GridLayer[]
  gridSize: number
  borderWidth: number
  mmPerUnit: number // How many millimeters each grid unit represents
}

// === Blob Geometry Primitives ===

export type PrimitiveType = "rectangle" | "roundedCorner" | "diagonalBridge"

// Additional curve classification to aid SVG path stitching
// Used by renderers (e.g., SvgPathRenderer) to know the local edge/arc type
export type CurveType =
  | "line-south"
  | "line-east"
  | "line-west"
  | "line-north"
  | "convex-south-east"
  | "convex-south-west"
  | "convex-north-west"
  | "convex-north-east"
  | "none"

export type Quadrant = 0 | 1 | 2 | 3 // 0=SE, 1=SW, 2=NW, 3=NE

export interface BlobPrimitive {
  type: PrimitiveType
  center: GridPoint
  quadrant: Quadrant
  size: number
  layerId: number
  // Indicates the local curve/edge shape for this primitive
  curveType: CurveType
  /**
   * Optional: override the rotation used for rendering.
   * When present, the renderer uses this quadrant for rotation instead of `quadrant`.
   * This allows placing a shape (e.g. convex-NE corner) in a different quadrant (e.g. SE).
   * `quadrant` still determines the physical position within the cell.
   */
  renderQuadrant?: Quadrant
}

export interface BlobGeometry {
  primitives: BlobPrimitive[]
  boundingBox: { min: GridPoint; max: GridPoint }
  gridSize: number
  borderWidth: number
}

export interface CurvePrimitive {
  center: GridPoint
  quadrant: Quadrant
  ends: [SubgridPoint, SubgridPoint] // Start and end points of the curve
  curveType: CurveType
  /** Physical size of the quadrant (half grid-cell). Needed for arc radius. */
  size?: number
  /**
   * When present and differs from quadrant, indicates the curve's visual
   * orientation is rotated relative to its physical quadrant. The arc command
   * must account for this when computing sweep direction.
   */
  renderQuadrant?: Quadrant
  /**
   * The center point of the quarter-circle arc (for convex/concave curves).
   * Used by the SVG arc command to compute the correct sweep direction.
   * For relOffset 0 this equals the quadrant's outer corner; for overrides
   * it may be at a different position.
   */
  arcCenter?: GridPoint
}

// === Neighborhood Analysis ===

export type NeighborhoodMap = boolean[][] // 3x3 grid of neighbor states

export interface NeighborAnalysis {
  // Core neighbor directions (8-directional)
  north: boolean
  northeast: boolean
  east: boolean
  southeast: boolean
  south: boolean
  southwest: boolean
  west: boolean
  northwest: boolean

  // Convenience properties
  hasOrthogonal: boolean
  hasDiagonal: boolean
  isIsolated: boolean

  // Adjacent cell bridge information - what diagonal bridges will adjacent cells render?
  // This helps avoid line segments conflicting with adjacent convex curves
  adjacentBridges: {
    northEast: boolean   // Will north cell render a diagonal bridge in its SE quadrant?
    northWest: boolean   // Will north cell render a diagonal bridge in its SW quadrant?
    southEast: boolean   // Will south cell render a diagonal bridge in its NE quadrant?
    southWest: boolean   // Will south cell render a diagonal bridge in its NW quadrant?
    eastNorth: boolean   // Will east cell render a diagonal bridge in its NW quadrant?
    eastSouth: boolean   // Will east cell render a diagonal bridge in its SW quadrant?
    westNorth: boolean   // Will west cell render a diagonal bridge in its NE quadrant?
    westSouth: boolean   // Will west cell render a diagonal bridge in its SE quadrant?
  }
}

// === Rendering System ===

export interface RenderStyle {
  fillColor?: string
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D | null
  style: RenderStyle
  zoom: number
  panOffset: GridPoint
}

// === Performance & Caching ===

export interface CacheKey {
  layerId: number
  points: string // Serialized point set for cache key
  gridSize: number
  borderWidth: number
}

export interface CachedGeometry {
  geometry: BlobGeometry
  cacheKey: string
  timestamp: number
}

export interface SpatialRegion {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// === Layer Compositing ===

export interface LayerGeometry {
  layer: GridLayer
  geometry: BlobGeometry
  renderOrder: number // Lower numbers render first (background)
}

export interface CompositeGeometry {
  layers: LayerGeometry[]
  boundingBox: { min: GridPoint; max: GridPoint }
  totalPrimitives: number
}

// === Geometric Constants ===

export const QUADRANT_ROTATIONS = [
  0,
  Math.PI / 2,
  Math.PI,
  (3 * Math.PI) / 2,
] as const
export const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1], // NW, N, NE
  [-1, 0],
  [0, 0],
  [1, 0], // W,  C, E
  [-1, 1],
  [0, 1],
  [1, 1], // SW, S, SE
] as const

// Quadrant neighbor check patterns for each quadrant (0=SE, 1=SW, 2=NW, 3=NE)
export const QUADRANT_NEIGHBOR_PATTERNS = [
  // SE quadrant: check E, SE, S
  [
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  // SW quadrant: check S, SW, W
  [
    [0, 1],
    [-1, 1],
    [-1, 0],
  ],
  // NW quadrant: check W, NW, N
  [
    [-1, 0],
    [-1, -1],
    [0, -1],
  ],
  // NE quadrant: check N, NE, E
  [
    [0, -1],
    [1, -1],
    [1, 0],
  ],
] as const

// === Error Types ===

export class BlobEngineError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
    this.name = "BlobEngineError"
  }
}

export class GeometryCacheError extends BlobEngineError {
  constructor(message: string) {
    super(message, "CACHE_ERROR")
  }
}

export class RenderError extends BlobEngineError {
  constructor(message: string) {
    super(message, "RENDER_ERROR")
  }
}
