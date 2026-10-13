/**
 * Turns a layer into one blob "piece" per lattice square, for the tile mesher.
 *
 * Every blob primitive fills one quadrant of a cell: a half-cell lattice
 * square. Its shape is one of
 *
 *   full   — the whole square
 *   disk   — quarter disk of radius ½ centred on one square corner
 *   bridge — the square minus that same quarter disk
 *
 * This is the corner-tile idea from src/lib/runner/tiles.ts taken one level
 * down: instead of 16 tiles per grid corner we keep the 4 quadrant pieces
 * separately, because quadrant overrides can put any piece in any square.
 * Each piece covers each square side either completely or not at all (a
 * disk covers the two sides meeting at its centre, a bridge the other two),
 * so outlines are exactly the square sides covered on one side only, plus
 * the arcs — which is also what SvgPathRenderer's edge cancellation yields.
 *
 * Plain layers (one group, no overrides) are classified straight from a
 * bitmap with the NeighborhoodAnalyzer rule. Layers with several groups,
 * half-offset groups or quadrant overrides go through the BlobEngine and
 * its primitives are dropped into the squares. Cutouts are punched natively
 * when they sit strictly inside full squares. Anything else — overlapping
 * pieces we can't union exactly, cutouts touching an outline, overlapping
 * cutouts — makes the whole layer fall back to the SVG → extrude path.
 */

import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { BlobPrimitive, GridLayer } from "@/lib/blob-engine/types"
import { getGridLayerPoints } from "@/lib/blob-engine/types"
import { getCutoutGeometry } from "@/lib/gridpaint/cutoutGeometry"
import type {
  CutoutHole,
  CutoutRegion,
  LayerMeshPlan,
  PieceGrid,
} from "@/types/threejs"

export const PIECE_EMPTY = 0
export const PIECE_FULL = 1
/** PIECE_DISK + c: quarter disk centred on square corner c */
export const PIECE_DISK = 2
/** PIECE_BRIDGE + c: square minus the quarter disk centred on corner c */
export const PIECE_BRIDGE = 6

/**
 * Square corners, counter-clockwise in y-up space: 0 = (0,0), 1 = (1,0),
 * 2 = (1,1), 3 = (0,1) in half-cell units. Side k runs from corner k to
 * corner k + 1: 0 = bottom, 1 = right, 2 = top, 3 = left.
 */
export const CORNER_DX = [0, 1, 1, 0] as const
export const CORNER_DY = [0, 0, 1, 1] as const

/** Bit k set ⇔ the piece covers side k */
export const SIDE_COVERAGE = new Uint8Array(10)
SIDE_COVERAGE[PIECE_FULL] = 0b1111
for (let c = 0; c < 4; c++) {
  SIDE_COVERAGE[PIECE_DISK + c] = (1 << c) | (1 << ((c + 3) % 4))
  SIDE_COVERAGE[PIECE_BRIDGE + c] = (1 << ((c + 1) % 4)) | (1 << ((c + 2) % 4))
}

/** Margin keeping cutout holes strictly inside their square rectangle */
const CUTOUT_EPS = 1e-4

export interface PlanLayerOptions {
  includeCutouts: boolean
  /** Converts mm-sized cutouts to grid units */
  mmPerUnit: number
}

/** Decide how a layer is meshed and, for the tile mesher, compute its pieces */
export function planLayerMesh(
  layer: GridLayer,
  options: PlanLayerOptions,
): LayerMeshPlan {
  const needsEngine =
    layer.groups.length > 1 ||
    layer.groups.some((g) => g.offsetPhaseX === "half" || g.offsetPhaseY === "half") ||
    hasQuadrantOverrides(layer)

  let grid: PieceGrid | null
  if (needsEngine) {
    const result = piecesFromLayerPrimitives(layer)
    if (typeof result === "string") return { kind: "fallback", reason: result }
    grid = result
  } else {
    grid = piecesFromPoints(getGridLayerPoints(layer))
  }
  if (!grid) return { kind: "empty" }

  let regions: CutoutRegion[] = []
  if (options.includeCutouts) {
    const result = planCutoutRegions(layer, grid, options.mmPerUnit)
    if (typeof result === "string") return { kind: "fallback", reason: result }
    regions = result
  }
  return { kind: "tiles", grid, regions }
}

function hasQuadrantOverrides(layer: GridLayer): boolean {
  if (!layer.pointModifications) return false
  for (const mods of layer.pointModifications.values()) {
    if (mods.quadrantOverrides) return true
  }
  return false
}

function parseKey(key: string): [number, number] {
  const comma = key.indexOf(",")
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))]
}

/**
 * Plain single-group layer → pieces, using the NeighborhoodAnalyzer rule:
 * a filled cell's quadrant is full if any of its 3 neighbours towards that
 * quadrant is filled, else a disk; an empty cell's quadrant is a bridge if
 * both orthogonal neighbours towards it are filled. Arcs are centred on the
 * cell centre either way.
 */
export function piecesFromPoints(points: Set<string>): PieceGrid | null {
  if (points.size === 0) return null
  const xs = new Int32Array(points.size)
  const ys = new Int32Array(points.size)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let n = 0
  for (const key of points) {
    const [x, y] = parseKey(key)
    xs[n] = x
    ys[n] = y
    n++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const cols = maxX - minX + 1
  const rows = maxY - minY + 1
  // Bitmap with a one-cell empty border, so neighbour lookups need no bounds checks
  const pw = cols + 2
  const cells = new Uint8Array(pw * (rows + 2))
  for (let k = 0; k < n; k++) cells[(ys[k] - minY + 1) * pw + (xs[k] - minX + 1)] = 1

  // Bridges need filled neighbours on both axes, so every piece lies inside
  // the bounding box of the filled cells.
  const width = 2 * cols
  const height = 2 * rows
  const codes = new Uint8Array(width * height)

  for (let y = minY; y <= maxY; y++) {
    const row = (y - minY + 1) * pw
    for (let x = minX; x <= maxX; x++) {
      const at = row + (x - minX + 1)
      const filled = cells[at] === 1
      // Cell (x, y) owns squares li ∈ {2(x-minX), +1} and, y-up, the south
      // half is the lower lattice row.
      const li = 2 * (x - minX)
      const lj = 2 * (maxY - y)
      for (let q = 0; q < 4; q++) {
        const dx = q === 0 || q === 3 ? 1 : -1 // SE, NE → east
        const dy = q === 0 || q === 1 ? 1 : -1 // SE, SW → south (y-down)
        const orthA = cells[at + dx] === 1
        const orthB = cells[at + dy * pw] === 1
        let code = PIECE_EMPTY
        // Corner of the square at the cell centre (see CORNER_DX/DY)
        const c = dx > 0 ? (dy < 0 ? 0 : 3) : dy < 0 ? 1 : 2
        if (filled) {
          const diag = cells[at + dx + dy * pw] === 1
          code = orthA || orthB || diag ? PIECE_FULL : PIECE_DISK + c
        } else if (orthA && orthB) {
          code = PIECE_BRIDGE + c
        }
        if (code === PIECE_EMPTY) continue
        const si = li + (dx > 0 ? 1 : 0)
        const sj = lj + (dy > 0 ? 0 : 1)
        codes[sj * width + si] = code
      }
    }
  }

  return { i0: 2 * minX - 1, j0: -2 * maxY - 1, width, height, codes }
}

// primitivePaths.ts rotation basis per quadrant (y-down world = R · local)
const ROT = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
] as const
// Arc-centre corner in the primitive's local frame per relOffset (×½)
const REL_CORNER = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const

interface PlacedPiece {
  i: number
  j: number
  code: number
}

/** Lattice square + piece code of one blob primitive (y-up lattice) */
export function placePrimitive(p: BlobPrimitive): PlacedPiece {
  const q = p.quadrant
  const dx = q === 0 || q === 3 ? 1 : -1
  const dy = q === 0 || q === 1 ? 1 : -1 // y-down
  const i = Math.round(2 * p.center.x) + (dx > 0 ? 0 : -1)
  const j = -Math.round(2 * p.center.y) + (dy > 0 ? -1 : 0)
  if (p.type === "rectangle") return { i, j, code: PIECE_FULL }

  const rq = p.renderQuadrant ?? q
  const rel = (((rq - q) % 4) + 4) % 4
  const [a, b, c, d] = ROT[q]
  const [lx, ly] = REL_CORNER[rel]
  // Corner position in doubled y-down coordinates, then y-up lattice
  const cx2 = Math.round(2 * p.center.x) + (a * lx + b * ly)
  const cy2 = -(Math.round(2 * p.center.y) + (c * lx + d * ly))
  const ox = cx2 - i
  const oy = cy2 - j
  const corner = oy === 0 ? (ox === 0 ? 0 : 1) : ox === 1 ? 2 : 3
  const base = p.type === "roundedCorner" ? PIECE_DISK : PIECE_BRIDGE
  return { i, j, code: base + corner }
}

/**
 * Union of two pieces in the same square, when it is itself a piece.
 * Returns -1 when it isn't (e.g. two disks on different corners).
 */
function unionPieces(a: number, b: number): number {
  if (a === b) return a
  if (a === PIECE_EMPTY) return b
  if (b === PIECE_EMPTY) return a
  if (a === PIECE_FULL || b === PIECE_FULL) return PIECE_FULL
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  // disk on corner c ∪ bridge on corner c = full square
  if (lo < PIECE_BRIDGE && hi >= PIECE_BRIDGE && hi - PIECE_BRIDGE === lo - PIECE_DISK) {
    return PIECE_FULL
  }
  return -1
}

/**
 * Multi-group / half-offset / override layers → pieces, via the BlobEngine
 * (group merging and overrides stay in one place). Returns a fallback
 * reason when two primitives share a square in a way we can't union.
 */
export function piecesFromLayerPrimitives(layer: GridLayer): PieceGrid | string | null {
  const engine = new BlobEngine({ enableCaching: false })
  const { primitives } = engine.generateLayerGeometry(layer, 1, 0)
  return piecesFromPrimitives(primitives)
}

export function piecesFromPrimitives(primitives: BlobPrimitive[]): PieceGrid | string | null {
  if (primitives.length === 0) return null
  const placed = primitives.map(placePrimitive)
  let minI = Infinity
  let minJ = Infinity
  let maxI = -Infinity
  let maxJ = -Infinity
  for (const p of placed) {
    if (p.i < minI) minI = p.i
    if (p.i > maxI) maxI = p.i
    if (p.j < minJ) minJ = p.j
    if (p.j > maxJ) maxJ = p.j
  }
  const width = maxI - minI + 1
  const height = maxJ - minJ + 1
  const codes = new Uint8Array(width * height)
  for (const p of placed) {
    const at = (p.j - minJ) * width + (p.i - minI)
    const merged = unionPieces(codes[at], p.code)
    if (merged < 0) return "overlapping primitives (half-offset group overlap)"
    codes[at] = merged
  }
  return { i0: minI, j0: minJ, width, height, codes }
}

/**
 * Group the layer's cutouts into rectangles of full squares that strictly
 * contain them. Returns a fallback reason if any cutout reaches a non-full
 * square (it would cut into an outline) or two cutouts overlap.
 */
export function planCutoutRegions(
  layer: GridLayer,
  grid: PieceGrid,
  mmPerUnit: number,
): CutoutRegion[] | string {
  const mods = layer.pointModifications
  if (!mods) return []

  let regions: CutoutRegion[] = []
  for (const [key, mod] of mods) {
    if (!mod.cutouts || mod.cutouts.length === 0) continue
    const [px, py] = parseKey(key)
    for (const cutout of mod.cutouts) {
      const g = getCutoutGeometry(cutout, px, py, mmPerUnit)
      const hole: CutoutHole = {
        sx: g.start.x,
        sy: -g.start.y,
        ex: g.end.x,
        ey: -g.end.y,
        radius: g.radius,
      }
      const r = hole.radius + CUTOUT_EPS
      regions.push({
        i0: Math.floor(2 * (Math.min(hole.sx, hole.ex) - r)) - grid.i0,
        i1: Math.floor(2 * (Math.max(hole.sx, hole.ex) + r)) + 1 - grid.i0,
        j0: Math.floor(2 * (Math.min(hole.sy, hole.ey) - r)) - grid.j0,
        j1: Math.floor(2 * (Math.max(hole.sy, hole.ey) + r)) + 1 - grid.j0,
        holes: [hole],
      })
    }
  }
  if (regions.length === 0) return []

  // Merge overlapping rectangles until stable
  let merged = true
  while (merged) {
    merged = false
    const next: CutoutRegion[] = []
    for (const region of regions) {
      const hit = next.find(
        (o) => o.i0 < region.i1 && region.i0 < o.i1 && o.j0 < region.j1 && region.j0 < o.j1,
      )
      if (hit) {
        hit.i0 = Math.min(hit.i0, region.i0)
        hit.i1 = Math.max(hit.i1, region.i1)
        hit.j0 = Math.min(hit.j0, region.j0)
        hit.j1 = Math.max(hit.j1, region.j1)
        hit.holes.push(...region.holes)
        merged = true
      } else {
        next.push({ ...region, holes: [...region.holes] })
      }
    }
    regions = next
  }

  for (const region of regions) {
    if (region.i0 < 0 || region.j0 < 0 || region.i1 > grid.width || region.j1 > grid.height) {
      return "cutout reaches beyond the shape"
    }
    for (let j = region.j0; j < region.j1; j++) {
      for (let i = region.i0; i < region.i1; i++) {
        if (grid.codes[j * grid.width + i] !== PIECE_FULL) {
          return "cutout touches the shape outline"
        }
      }
    }
    const { holes } = region
    for (let a = 0; a < holes.length; a++) {
      for (let b = a + 1; b < holes.length; b++) {
        const gap = segmentDistance(holes[a], holes[b]) - holes[a].radius - holes[b].radius
        if (gap <= CUTOUT_EPS) return "overlapping cutouts"
      }
    }
  }
  return regions
}

/** Distance between the axis segments of two pills */
function segmentDistance(a: CutoutHole, b: CutoutHole): number {
  return Math.min(
    pointSegmentDistance(a.sx, a.sy, b),
    pointSegmentDistance(a.ex, a.ey, b),
    pointSegmentDistance(b.sx, b.sy, a),
    pointSegmentDistance(b.ex, b.ey, a),
    segmentsIntersect(a, b) ? 0 : Infinity,
  )
}

function pointSegmentDistance(px: number, py: number, s: CutoutHole): number {
  const dx = s.ex - s.sx
  const dy = s.ey - s.sy
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.sx) * dx + (py - s.sy) * dy) / len2))
  return Math.hypot(px - s.sx - t * dx, py - s.sy - t * dy)
}

function segmentsIntersect(a: CutoutHole, b: CutoutHole): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox)
  const d1 = cross(b.sx, b.sy, b.ex, b.ey, a.sx, a.sy)
  const d2 = cross(b.sx, b.sy, b.ex, b.ey, a.ex, a.ey)
  const d3 = cross(a.sx, a.sy, a.ex, a.ey, b.sx, b.sy)
  const d4 = cross(a.sx, a.sy, a.ex, a.ey, b.ex, b.ey)
  return d1 * d2 < 0 && d3 * d4 < 0
}
