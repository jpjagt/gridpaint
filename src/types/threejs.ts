import type * as THREE from "three"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

/** One viewer participating in cross-canvas camera sync (see CameraSyncGroup). */
export interface CameraSyncMember {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
}

/**
 * A layer's blob shape as one piece per lattice square (see blobPieces.ts).
 *
 * The lattice is the half-cell grid: square (i, j) spans
 * x ∈ [i/2, (i+1)/2], y ∈ [j/2, (j+1)/2] in y-up scene units (grid cell
 * (cx, cy) is centred at (cx, -cy)). Codes are the PIECE_* constants.
 */
export interface PieceGrid {
  /** Lattice index of the first square column / row */
  i0: number
  j0: number
  width: number
  height: number
  /** One PIECE_* code per square, row-major (index = j * width + i) */
  codes: Uint8Array
}

/**
 * A cutout hole the tile mesher punches natively: a circle or pill lying
 * strictly inside a rectangle of full squares.
 */
export interface CutoutHole {
  /** Pill axis endpoints (equal for a circle), y-up scene units */
  sx: number
  sy: number
  ex: number
  ey: number
  radius: number
}

/** Rectangle of full squares (grid-relative, end-exclusive) holding holes */
export interface CutoutRegion {
  i0: number
  j0: number
  i1: number
  j1: number
  holes: CutoutHole[]
}

/**
 * How one layer gets meshed: natively by the tile mesher, or via the legacy
 * SVG → ExtrudeGeometry path when it uses something the mesher can't
 * represent exactly (`reason` says what).
 */
export type LayerMeshPlan =
  | { kind: "tiles"; grid: PieceGrid; regions: CutoutRegion[] }
  | { kind: "fallback"; reason: string }
  | { kind: "empty" }

/** Per-layer settings for appending a layer to the mesh builder */
export interface TileLayerMeshOptions {
  /** Layer occupies z ∈ [z0, z0 + 1] (thickness is applied as a scale) */
  z0: number
  /** Linear RGB vertex colour */
  color: [number, number, number]
  /** Uniform per-layer scale about the origin */
  scale: number
  /** Segments per quarter arc */
  arcSegments: number
}

/** How each stacked layer was built (exposed for tests and debugging) */
export interface LayeredModelLayerInfo {
  layerId: number
  /** Stack slot: the layer spans z ∈ [slot, slot + 1] before thickness scaling */
  slot: number
  mode: "tiles" | "fallback"
  fallbackReason?: string
}

/** Finished buffers of the tile mesher (indexed triangles + line segments) */
export interface TileMeshBuffers {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
  /** Line segment endpoints (xyz pairs) for the edge overlay */
  lines: Float32Array
}

/**
 * A classified solid region extracted from a layer's SVG loops, in SVG
 * coordinates (y-down), before any Y-flip into Three.js space.
 *
 * `contour` is the outer boundary (CW in SVG coords per the SvgPathRenderer
 * orientation guarantee); `holes` are the CCW loops assigned to this contour.
 */
export interface ClassifiedSvgShape {
  contour: THREE.Vector2[]
  holes: THREE.Vector2[][]
  /** Absolute shoelace area of the contour, in SVG units². */
  area: number
}
