/**
 * The GridPaint blob rule as 16 precomputed "corner tiles".
 *
 * The blob engine decides each quadrant of a cell from the 2x2 block of
 * cells around the grid corner that quadrant touches (see
 * NeighborhoodAnalyzer.classifyQuadrant):
 *
 *   filled cell, any neighbour in that 2x2 block  → full square quadrant
 *   filled cell, no neighbours                    → rounded corner
 *   empty cell, both orthogonal neighbours filled → diagonal bridge
 *   otherwise                                     → empty
 *
 * So if we centre a tile on every grid corner (spanning half a cell in each
 * direction), its shape depends only on the 4 cells around that corner: 16
 * cases, marching-squares style. Tile borders run through cell centres,
 * where both sides are always equally filled, so outlines never lie on a
 * tile border — shapes assembled from tiles are seamless.
 *
 * The arcs here are exact quarter circles of radius 1/2 centred on cell
 * centres (the 2D renderer approximates the same circles with béziers).
 *
 * Case bits: SW = 1, SE = 2, NE = 4, NW = 8. Local coords: u right, v up,
 * tile centre (the grid corner) at (0, 0), tile spans [-0.5, 0.5]².
 */

import type { TileTemplate } from "@/types/runner"

export const BIT_SW = 1
export const BIT_SE = 2
export const BIT_NE = 4
export const BIT_NW = 8
export const CASE_FULL = 15

type PieceKind = "empty" | "full" | "disk" | "bridge"

interface QuadrantSpec {
  bit: number
  /** Far corner = centre of the cell this quadrant belongs to */
  fx: number
  fy: number
  orthA: number
  orthB: number
  diag: number
}

const QUADRANTS: QuadrantSpec[] = [
  { bit: BIT_NE, fx: 0.5, fy: 0.5, orthA: BIT_NW, orthB: BIT_SE, diag: BIT_SW },
  { bit: BIT_NW, fx: -0.5, fy: 0.5, orthA: BIT_NE, orthB: BIT_SW, diag: BIT_SE },
  { bit: BIT_SW, fx: -0.5, fy: -0.5, orthA: BIT_NW, orthB: BIT_SE, diag: BIT_NE },
  { bit: BIT_SE, fx: 0.5, fy: -0.5, orthA: BIT_NE, orthB: BIT_SW, diag: BIT_NW },
]

export function pieceKind(c: number, q: QuadrantSpec): PieceKind {
  const has = (b: number) => (c & b) !== 0
  if (has(q.bit)) {
    return has(q.orthA) || has(q.orthB) || has(q.diag) ? "full" : "disk"
  }
  return has(q.orthA) && has(q.orthB) ? "bridge" : "empty"
}

/** Quarter arc around the far corner, from (fx, 0) to (0, fy) */
function arcPoints(q: QuadrantSpec, segments: number): number[] {
  const a0 = Math.atan2(-q.fy, 0)
  let a1 = Math.atan2(0, -q.fx)
  let d = a1 - a0
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  a1 = a0 + d
  const pts: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (d * i) / segments
    let u = q.fx + 0.5 * Math.cos(a)
    let v = q.fy + 0.5 * Math.sin(a)
    // Snap the endpoints exactly so neighbouring tiles share coordinates
    if (i === 0) {
      u = q.fx
      v = 0
    } else if (i === segments) {
      u = 0
      v = q.fy
    }
    pts.push(u, v)
  }
  return pts
}

function buildTemplate(c: number, segments: number): TileTemplate {
  const tris: number[] = []
  const contour: number[] = []
  const filledEdge = new Map<number, boolean>()

  for (const q of QUADRANTS) {
    const kind = pieceKind(c, q)
    filledEdge.set(q.bit, kind === "full" || kind === "bridge")

    if (kind === "full") {
      tris.push(0, 0, q.fx, 0, q.fx, q.fy)
      tris.push(0, 0, q.fx, q.fy, 0, q.fy)
    } else if (kind === "disk" || kind === "bridge") {
      const pts = arcPoints(q, segments)
      // Disk: fan from the cell centre. Bridge: fan from the grid corner.
      const ox = kind === "disk" ? q.fx : 0
      const oy = kind === "disk" ? q.fy : 0
      for (let i = 0; i < segments; i++) {
        tris.push(ox, oy, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3])
        contour.push(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3])
      }
    }
  }

  // Inner edges along the axes: an outline wherever one side is filled and
  // the other isn't. Disks only touch the axes at their endpoints.
  const edge = (a: number, b: number, u: number, v: number) => {
    if (filledEdge.get(a) !== filledEdge.get(b)) contour.push(0, 0, u, v)
  }
  // Left half before right half so the mesher can merge horizontal runs
  edge(BIT_NW, BIT_SW, -0.5, 0)
  edge(BIT_NE, BIT_SE, 0.5, 0)
  edge(BIT_NE, BIT_NW, 0, 0.5)
  edge(BIT_SE, BIT_SW, 0, -0.5)

  return { tris: new Float32Array(tris), contour: new Float32Array(contour) }
}

const cache = new Map<number, TileTemplate[]>()

/** All 16 templates for a given arc resolution (cached) */
export function getTileTemplates(arcSegments: number): TileTemplate[] {
  const segs = Math.max(1, Math.round(arcSegments))
  let set = cache.get(segs)
  if (!set) {
    set = []
    for (let c = 0; c < 16; c++) set.push(buildTemplate(c, segs))
    cache.set(segs, set)
  }
  return set
}

/** Is tile shape `a` contained in tile shape `b`? (shapes grow monotonically with bits) */
export function caseContainedIn(a: number, b: number): boolean {
  return (a & b) === a
}
