/**
 * Types for the infinite runner (`/#/runner`).
 *
 * World coordinates are in tiles. The character travels along -Z. A world
 * "slice" is one laser-cut layer: a 2D grid of cells (x = column, y = row)
 * extruded `sliceDepth` tiles along Z.
 */

// === Config ===

export interface RunnerColors {
  /** Faces that look at the camera (layer fronts) */
  front: string
  /** Layer sides (cut edges) */
  side: string
  /** Side faces pointing up/down (ground surface, ledges). Same as side ⇒ fully flat */
  sideTop: string
  /** Shape outlines */
  line: string
  /** Seams between consecutive layers */
  seam: string
  /** Fog and background */
  fog: string
  characterBody: string
  characterShade: string
  characterLine: string
  shadow: string
}

export interface RunnerFogConfig {
  /** Distance (tiles) where fog starts */
  near: number
  /** Distance (tiles) where everything is fully fogged */
  far: number
  /** Curve applied to the 0..1 fog ramp; >1 keeps the mid-distance clearer */
  exponent: number
}

export interface RunnerLinesConfig {
  outlines: boolean
  seams: boolean
  /** 0..1 */
  seamOpacity: number
  /** Seams fade out between these distances (tiles) to avoid far-away moiré */
  seamFadeStart: number
  seamFadeEnd: number
}

export interface RunnerCameraConfig {
  /** Tiles above the character's centre */
  up: number
  /** Tiles behind the character */
  back: number
  /** Look target: tiles ahead of the character */
  lookAhead: number
  /** Look target: tiles above the character's centre */
  lookUp: number
  /** Vertical field of view in degrees */
  fov: number
}

export interface RunnerCharacterConfig {
  /** "ball" | "arrow" */
  kind: RunnerCharacterKind
  radius: number
  /** Show a soft blob shadow under the character */
  shadow: boolean
}

export type RunnerCharacterKind = "ball" | "arrow"

export interface RunnerWorldConfig {
  seed: number
  /** Layer thickness in tiles (0.5 = half a tile, 1 = a full tile) */
  sliceDepth: number
  /** Slices per streamed chunk */
  chunkSlices: number
  /** Columns either side of the path (total width = 2 * halfWidth + 1) */
  halfWidth: number
  /** Highest generated row (rows go from -2 up to this) */
  maxRow: number
  /** How far ahead (tiles) the world is built */
  viewDistance: number
  /** Arc segments per quarter circle, nearest LOD first */
  arcSegments: number[]
  /** Distance thresholds (tiles) between LOD levels; length = arcSegments.length - 1 */
  lodDistances: number[]
  /** Average biome zone length (tiles) */
  zoneLength: number
  /** Length (tiles) of the cross-fade between two biomes */
  transitionLength: number
  /** Relative odds of each biome being picked for a zone (0 disables it) */
  biomeWeights: Record<BiomeId, number>
}

export interface RunnerRenderConfig {
  maxPixelRatio: number
  antialias: boolean
  /** Max chunks handed to the GPU per frame (keeps uploads from spiking a frame) */
  chunksPerFrame: number
}

export interface RunnerConfig {
  /** Tiles per second */
  speed: number
  /** Distance (tiles) to start at */
  startDistance: number
  colors: RunnerColors
  fog: RunnerFogConfig
  lines: RunnerLinesConfig
  camera: RunnerCameraConfig
  character: RunnerCharacterConfig
  world: RunnerWorldConfig
  render: RunnerRenderConfig
}

// === World generation ===

export type BiomeId = "desert" | "ruins" | "dream" | "plains" | "megacity"

/** The subset of config the generator (worker) needs */
export interface WorldGenParams {
  seed: number
  sliceDepth: number
  chunkSlices: number
  halfWidth: number
  maxRow: number
  zoneLength: number
  transitionLength: number
  biomeWeights: Record<BiomeId, number>
  /** Cells that must stay empty in every slice, as [column, row] */
  tunnels: [number, number][]
  /** Rows 0..doorHeight-1 (3 wide) are cut through anything built across the path */
  doorHeight: number
}

/**
 * One slice of cells. `cells[(row - MIN_ROW) * cols + (col + halfWidth)]`
 * is 1 when filled.
 */
export interface SliceGrid {
  cols: number
  rows: number
  halfWidth: number
  cells: Uint8Array
}

/** Per-slice context a biome receives */
export interface SliceContext {
  /** Slice index (0 at the start, increasing forward) */
  k: number
  /** Distance travelled at the centre of the slice, in tiles */
  zt: number
}

export interface Biome {
  id: BiomeId
  /** 1 = solid ground, 0 = only the walkway */
  ground: number
  /** Fill `grid` (already cleared) with this biome's cells for one slice */
  fill(ctx: SliceContext, grid: SliceGrid): void
}

export interface ZoneSample {
  /** Biome of the zone we're in (or coming from, during a transition) */
  from: Biome
  /** Biome we're transitioning into; equals `from` outside transitions */
  to: Biome
  /** 0 = fully `from`, 1 = fully `to` */
  t: number
}

/**
 * A procedurally placed structure. `contains` is called with coordinates
 * relative to the structure's centre (already symmetry-folded when the
 * structure is symmetric).
 */
export interface Structure {
  /** Centre column */
  cx: number
  /** Centre along the path (tiles) */
  cz: number
  /** Half extent in columns (for culling) */
  hx: number
  /** Half extent along Z in tiles (for culling) */
  hz: number
  /** Lowest and highest row the structure can occupy (for culling) */
  bottom: number
  top: number
  /** 0 = none, 2 = mirror in X, 4 = mirror in X and Z */
  symmetry: 0 | 2 | 4
  contains(lx: number, row: number, lz: number): boolean
}

/** Builds a structure for one lattice cell, or null to leave it empty */
export type StructureFactory = (
  rng: () => number,
  cx: number,
  cz: number,
) => Structure | null

export interface StructureFieldOptions {
  /** Lattice spacing across (columns) and along (tiles) the path */
  spacingX: number
  spacingZ: number
  /** Chance a lattice cell holds a structure */
  probability: number
  /** Keep structure centres at least this many columns from the path */
  minPathDistance: number
  /** Only a single lattice column, centred on the path */
  onPath: boolean
  factory: StructureFactory
}

// === Meshing ===

/** Precomputed geometry for one of the 16 corner configurations */
export interface TileTemplate {
  /** Front-face triangles as (u, v) pairs, local to the tile centre */
  tris: Float32Array
  /** Outline segments as (u0, v0, u1, v1) */
  contour: Float32Array
}

export interface ChunkMeshData {
  /** Front faces (xyz triangles) */
  fronts: Float32Array
  /** Side walls (xyz triangles) */
  sides: Float32Array
  /** Shape outlines (xyz line segment pairs) */
  outlines: Float32Array
  /** Seams between equal consecutive layers (xyz line segment pairs) */
  seams: Float32Array
}

// === Worker protocol ===

export type WorkerRequest =
  | { type: "init"; params: WorldGenParams }
  | {
      type: "build"
      chunk: number
      lod: number
      arcSegments: number
      /** Only mesh tiles with |x| <= colLimit */
      colLimit: number
      generation: number
    }

export interface WorkerChunkResponse {
  type: "chunk"
  chunk: number
  lod: number
  generation: number
  mesh: ChunkMeshData
  /** Biome (or transition) at the chunk's centre */
  biome: string
  /** Milliseconds the worker spent generating + meshing */
  ms: number
}

export type WorkerResponse = WorkerChunkResponse

// === Engine stats (HUD) ===

export interface RunnerStats {
  fps: number
  /** Worst frame time over the last ~2 seconds, ms */
  worstFrameMs: number
  /** 99th-percentile frame time over the last ~2 seconds, ms */
  p99FrameMs: number
  chunks: number
  triangles: number
  lineSegments: number
  avgChunkBuildMs: number
  distance: number
  biome: string
}

export interface Recording {
  stop(): void
}
