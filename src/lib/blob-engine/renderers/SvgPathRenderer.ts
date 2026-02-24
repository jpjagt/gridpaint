/**
 * SvgPathRenderer - Generates continuous SVG paths by stitching quadrant arcs
 *
 * Strategy
 * - Convert each roundedCorner/diagonalBridge primitive into a CurvePrimitive
 *   with SubgridPoint endpoints.
 * - Eliminate internal edges (line segments shared between adjacent filled quadrants).
 * - Build an adjacency map keyed by quantized endpoints so matching endpoints
 *   connect deterministically.
 * - Trace closed loops by walking unused segments endpoint-to-endpoint.
 * - Emit one SVG subpath per loop: M … (arcs/lines) … Z
 * - Emit separate CCW circular paths for cutouts.
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  CompositeGeometry,
  CurvePrimitive,
  CurveType,
  GridLayer,
  Quadrant,
  RenderStyle,
  SubgridPoint,
} from "../types"
import {
  Renderer,
  type RenderOptions,
  type ViewportTransform,
} from "./Renderer"
import type { PointModifications } from "@/types/gridpaint"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"
import {
  curvePrimitiveArraysToSvgPaths,
} from "../utils/svgPathUtils"

/**
 * Transform a local-space point (lx, ly) to absolute subgrid coordinates
 * based on the physical quadrant's rotation.
 *
 * Quadrant rotations (about cell center):
 *   Q0 (SE, 0°):   (lx, ly) → (cx + lx, cy + ly)
 *   Q1 (SW, 90°):  (lx, ly) → (cx - ly, cy + lx)
 *   Q2 (NW, 180°): (lx, ly) → (cx - lx, cy - ly)
 *   Q3 (NE, 270°): (lx, ly) → (cx + ly, cy - lx)
 */
function localToAbsolute(
  lx: number,
  ly: number,
  cx: number,
  cy: number,
  quadrant: Quadrant,
): SubgridPoint {
  let ax: number, ay: number
  switch (quadrant) {
    case 0: ax = cx + lx; ay = cy + ly; break
    case 1: ax = cx - ly; ay = cy + lx; break
    case 2: ax = cx - lx; ay = cy - ly; break
    case 3: ax = cx + ly; ay = cy - lx; break
  }
  return { x: ax.toString(), y: ay.toString() }
}

/**
 * Arc endpoints in local quadrant space for each relOffset.
 * Derived from Canvas2DRenderer's Bézier geometry (ignoring border expansion).
 * s = 0.5 (half grid cell).
 *
 *   relOffset 0: arc (0.5, 0) → (0, 0.5)
 *   relOffset 1: arc (0, 0)   → (0.5, 0.5)
 *   relOffset 2: arc (0, 0.5) → (0.5, 0)
 *   relOffset 3: arc (0.5, 0.5) → (0, 0)
 */
const ARC_ENDPOINTS_LOCAL: Array<[[number, number], [number, number]]> = [
  [[0.5, 0], [0, 0.5]],     // relOffset 0
  [[0, 0], [0.5, 0.5]],     // relOffset 1
  [[0, 0.5], [0.5, 0]],     // relOffset 2
  [[0.5, 0.5], [0, 0]],     // relOffset 3
]

/**
 * Straight-edge segments for each relOffset, for roundedCorner shapes.
 * Each entry is [start, end] in local space. These are the two straight
 * edges of the filled triangle, listed in boundary-traversal order
 * (after the arc, continuing CW around the shape).
 *
 *   relOffset 0: (0, 0.5)→(0, 0), (0, 0)→(0.5, 0)
 *   relOffset 1: (0.5, 0.5)→(0.5, 0), (0.5, 0)→(0, 0)
 *   relOffset 2: (0.5, 0)→(0.5, 0.5), (0.5, 0.5)→(0, 0.5)
 *   relOffset 3: (0, 0)→(0, 0.5), (0, 0.5)→(0.5, 0.5)
 */
const ROUNDED_CORNER_LINES_LOCAL: Array<Array<[[number, number], [number, number]]>> = [
  [[[0, 0.5], [0, 0]], [[0, 0], [0.5, 0]]],           // relOffset 0
  [[[0.5, 0.5], [0.5, 0]], [[0.5, 0], [0, 0]]],       // relOffset 1
  [[[0.5, 0], [0.5, 0.5]], [[0.5, 0.5], [0, 0.5]]],   // relOffset 2
  [[[0, 0], [0, 0.5]], [[0, 0.5], [0.5, 0.5]]],       // relOffset 3
]

/**
 * Straight-edge segments for each relOffset, for diagonalBridge shapes.
 * Listed in boundary-traversal order after the arc.
 *
 *   relOffset 0: (0, 0.5)→(0.5, 0.5), (0.5, 0.5)→(0.5, 0)
 *   relOffset 1: (0.5, 0.5)→(0, 0.5), (0, 0.5)→(0, 0)
 *   relOffset 2: (0.5, 0)→(0, 0), (0, 0)→(0, 0.5)
 *   relOffset 3: (0, 0)→(0.5, 0), (0.5, 0)→(0.5, 0.5)
 */
const BRIDGE_LINES_LOCAL: Array<Array<[[number, number], [number, number]]>> = [
  [[[0, 0.5], [0.5, 0.5]], [[0.5, 0.5], [0.5, 0]]],   // relOffset 0
  [[[0.5, 0.5], [0, 0.5]], [[0, 0.5], [0, 0]]],       // relOffset 1
  [[[0.5, 0], [0, 0]], [[0, 0], [0, 0.5]]],             // relOffset 2
  [[[0, 0], [0.5, 0]], [[0.5, 0], [0.5, 0.5]]],       // relOffset 3
]

/**
 * Arc center positions in local quadrant space for each relOffset.
 * The arc center is the geometric center of the quarter-circle arc.
 * Derived from Canvas2D Bézier midpoint analysis (cubic Bézier midpoint
 * at t=0.5 matches the circular arc centered at these positions).
 *
 *   relOffset 0: (0, 0)     — cell center (in local space)
 *   relOffset 1: (0.5, 0)
 *   relOffset 2: (0.5, 0.5) — quadrant's outer corner
 *   relOffset 3: (0, 0.5)
 */
const ARC_CENTERS_LOCAL: Array<[number, number]> = [
  [0, 0],      // relOffset 0 — cell center
  [0.5, 0],    // relOffset 1
  [0.5, 0.5],  // relOffset 2 — outer corner
  [0, 0.5],    // relOffset 3
]

/**
 * Convert a BlobPrimitive into CurvePrimitives representing ALL boundary edges.
 *
 * For roundedCorner/diagonalBridge, this emits 3 edges: 1 arc + 2 straight lines.
 * The straight lines include both cell-boundary and intra-cell edges. Internal
 * edge elimination (run later) removes edges shared between adjacent filled
 * quadrants.
 *
 * For rectangles, emits 1 line segment for the exposed cell-boundary edge.
 */
function blobPrimitiveToCurvePrimitives(
  primitive: BlobPrimitive,
): CurvePrimitive[] {
  const cx = primitive.center.x
  const cy = primitive.center.y
  const q = primitive.quadrant
  const rq = primitive.renderQuadrant ?? q
  const relOffset = ((rq - q) % 4 + 4) % 4

  // For rectangles, use the existing line-based logic (rectangles don't have arcs)
  if (primitive.type === "rectangle") {
    return [
      {
        center: { x: cx, y: cy },
        quadrant: q,
        ends: getRectangleEnds(primitive),
        curveType: primitive.curveType,
      },
    ]
  }

  // Compute arc center in absolute coordinates
  const arcCenterLocal = ARC_CENTERS_LOCAL[relOffset]
  const arcCenterAbs = localToAbsolute(arcCenterLocal[0], arcCenterLocal[1], cx, cy, q)
  const arcCenter = {
    x: parseFloat(arcCenterAbs.x),
    y: parseFloat(arcCenterAbs.y),
  }

  const result: CurvePrimitive[] = []

  // 1. Arc primitive
  const arcEnds = ARC_ENDPOINTS_LOCAL[relOffset]
  const arcStart = localToAbsolute(arcEnds[0][0], arcEnds[0][1], cx, cy, q)
  const arcEnd = localToAbsolute(arcEnds[1][0], arcEnds[1][1], cx, cy, q)

  result.push({
    center: { x: cx, y: cy },
    quadrant: q,
    ends: [arcStart, arcEnd],
    curveType: primitive.curveType,
    size: primitive.size,
    renderQuadrant: relOffset === 0 ? undefined : rq,
    arcCenter,
  })

  // 2. Line segment primitives for the straight edges
  const linesLocal =
    primitive.type === "roundedCorner"
      ? ROUNDED_CORNER_LINES_LOCAL[relOffset]
      : BRIDGE_LINES_LOCAL[relOffset]

  for (const [lineStart, lineEnd] of linesLocal) {
    const absStart = localToAbsolute(lineStart[0], lineStart[1], cx, cy, q)
    const absEnd = localToAbsolute(lineEnd[0], lineEnd[1], cx, cy, q)

    // Classify the line based on its position relative to the cell
    const lineCurveType = classifyLineSegment(
      parseFloat(absStart.x),
      parseFloat(absStart.y),
      parseFloat(absEnd.x),
      parseFloat(absEnd.y),
      cx,
      cy,
    )

    result.push({
      center: { x: cx, y: cy },
      quadrant: q,
      ends: [absStart, absEnd],
      curveType: lineCurveType,
      size: primitive.size,
      renderQuadrant: relOffset === 0 ? undefined : rq,
    })
  }

  return result
}

/**
 * Classify a line segment by its position relative to the cell.
 * Returns a CurveType for cell-boundary edges, or "none" for intra-cell edges.
 * Intra-cell edges are handled separately by eliminateIntraCellEdges().
 */
function classifyLineSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
): CurveType {
  // Check if both endpoints are on the same cell boundary
  const bothOnNorth = y1 === cy - 0.5 && y2 === cy - 0.5
  const bothOnSouth = y1 === cy + 0.5 && y2 === cy + 0.5
  const bothOnEast = x1 === cx + 0.5 && x2 === cx + 0.5
  const bothOnWest = x1 === cx - 0.5 && x2 === cx - 0.5

  if (bothOnNorth) return "line-north"
  if (bothOnSouth) return "line-south"
  if (bothOnEast) return "line-east"
  if (bothOnWest) return "line-west"

  // Intra-cell edge or diagonal — keep as "none" for now.
  // eliminateIntraCellEdges() will handle these.
  return "none"
}

/**
 * Get endpoints for rectangle primitives (line segments on exposed edges).
 * This is the original logic for rectangles, unchanged.
 */
function getRectangleEnds(
  primitive: BlobPrimitive,
): [SubgridPoint, SubgridPoint] {
  const cx = primitive.center.x
  const cy = primitive.center.y
  const quadrant =
    {
      0: "SE",
      1: "SW",
      2: "NW",
      3: "NE",
    }[primitive.quadrant] || primitive.quadrant
  const curveType = primitive.curveType

  const p = {
    bl: { x: (cx - 0.5).toString(), y: (cy + 0.5).toString() },
    br: { x: (cx + 0.5).toString(), y: (cy + 0.5).toString() },
    tl: { x: (cx - 0.5).toString(), y: (cy - 0.5).toString() },
    tr: { x: (cx + 0.5).toString(), y: (cy - 0.5).toString() },
    tc: { x: cx.toString(), y: (cy - 0.5).toString() },
    bc: { x: cx.toString(), y: (cy + 0.5).toString() },
    cl: { x: (cx - 0.5).toString(), y: cy.toString() },
    cr: { x: (cx + 0.5).toString(), y: cy.toString() },
  }

  switch (curveType) {
    case "line-south":
      if (quadrant === "SE") return [p.bc, p.br]
      else if (quadrant === "SW") return [p.bl, p.bc]
      else throw new Error("invalid primitive")
    case "line-north":
      if (quadrant === "NE") return [p.tc, p.tr]
      else if (quadrant === "NW") return [p.tl, p.tc]
      else throw new Error("invalid primitive")
    case "line-east":
      if (quadrant === "SE") return [p.cr, p.br]
      else if (quadrant === "NE") return [p.cr, p.tr]
      else throw new Error("invalid primitive")
    case "line-west":
      if (quadrant === "SW") return [p.cl, p.bl]
      else if (quadrant === "NW") return [p.cl, p.tl]
      else throw new Error("invalid primitive")
    default:
      throw new Error(`Unknown rectangle curve type: ${curveType}`)
  }
}

/**
 * Ensures a path is ordered clockwise using the shoelace formula.
 * If counter-clockwise, reverses the path and flips all primitive directions.
 */
function ensureClockwiseOrder(path: CurvePrimitive[]): CurvePrimitive[] {
  if (path.length < 3) return path // Need at least 3 points for direction

  // Calculate signed area using shoelace formula
  let signedArea = 0
  for (let i = 0; i < path.length; i++) {
    const current = path[i].ends[0] // Start point of current primitive
    const next = path[(i + 1) % path.length].ends[0] // Start point of next primitive

    const x1 = parseFloat(current.x)
    const y1 = parseFloat(current.y)
    const x2 = parseFloat(next.x)
    const y2 = parseFloat(next.y)

    signedArea += (x2 - x1) * (y2 + y1)
  }

  // If signedArea > 0, path is clockwise; if < 0, counter-clockwise
  if (signedArea > 0) {
    return path
  }

  // Reverse the path and flip each primitive's direction
  return path
    .slice()
    .reverse()
    .map((primitive) => ({
      ...primitive,
      ends: [primitive.ends[1], primitive.ends[0]] as [
        SubgridPoint,
        SubgridPoint,
      ],
    }))
}

/**
 * Eliminate internal edges between touching filled regions.
 * A line-segment primitive is "internal" if the adjacent quadrant on the
 * other side of its edge is also filled AND covers the cell-boundary area.
 *
 * Only rectangles and diagonalBridges fill the cell-boundary area of their
 * quadrant. RoundedCorners (convex) leave the cell-boundary corner area
 * empty — a line segment facing a roundedCorner should NOT be eliminated.
 */
function eliminateInternalEdges(
  curvePrimitives: CurvePrimitive[],
  allPrimitives: BlobPrimitive[],
): CurvePrimitive[] {
  // Build maps: filled quadrant keys → primitive type
  const filledQuadrants = new Map<string, BlobPrimitive>()
  for (const prim of allPrimitives) {
    const key = `${prim.center.x},${prim.center.y}:${prim.quadrant}`
    filledQuadrants.set(key, prim)
  }

  return curvePrimitives.filter((cp) => {
    // Only line segments can be internal edges
    if (!cp.curveType.startsWith("line-")) return true

    const { x, y } = cp.center
    const q = cp.quadrant
    const adjKey = getAdjacentQuadrantKey(x, y, q, cp.curveType)
    if (adjKey) {
      const adjPrim = filledQuadrants.get(adjKey)
      if (adjPrim) {
        // Only eliminate if the adjacent primitive fills the cell-boundary area.
        // Rectangles and diagonalBridges fill to the edge; roundedCorners don't.
        if (adjPrim.type === "rectangle" || adjPrim.type === "diagonalBridge") {
          return false // Internal edge: eliminate
        }
        // roundedCorner: the adjacent quadrant has a convex arc that doesn't
        // reach the cell boundary → keep this line segment
      }
    }
    return true // Boundary edge: keep
  })
}

/**
 * Get the key of the adjacent quadrant across the given edge.
 * Returns null if the mapping is not applicable.
 */
function getAdjacentQuadrantKey(
  x: number,
  y: number,
  quadrant: Quadrant,
  curveType: string,
): string | null {
  // Map: edge type + quadrant -> adjacent (point, quadrant)
  if (curveType === "line-south" && quadrant === 0) return `${x},${y + 1}:3`
  if (curveType === "line-south" && quadrant === 1) return `${x},${y + 1}:2`
  if (curveType === "line-east" && quadrant === 0) return `${x + 1},${y}:1`
  if (curveType === "line-east" && quadrant === 3) return `${x + 1},${y}:2`
  if (curveType === "line-north" && quadrant === 3) return `${x},${y - 1}:0`
  if (curveType === "line-north" && quadrant === 2) return `${x},${y - 1}:1`
  if (curveType === "line-west" && quadrant === 1) return `${x - 1},${y}:0`
  if (curveType === "line-west" && quadrant === 2) return `${x - 1},${y}:3`
  return null
}

/**
 * Eliminate intra-cell edges (edges between quadrants within the same cell).
 *
 * An intra-cell edge runs from the cell center to an edge-midpoint. It lies
 * on the boundary between two quadrants of the same cell. This edge is
 * "internal" if the quadrant on the other side also has a filled primitive.
 *
 * Intra-cell edges have curveType "none" (classified by classifyLineSegment).
 */
function eliminateIntraCellEdges(
  curvePrimitives: CurvePrimitive[],
  allPrimitives: BlobPrimitive[],
): CurvePrimitive[] {
  // Build filled quadrant set
  const filledQuadrants = new Set<string>()
  for (const prim of allPrimitives) {
    filledQuadrants.add(`${prim.center.x},${prim.center.y}:${prim.quadrant}`)
  }

  return curvePrimitives.filter((cp) => {
    // Only process "none"-typed lines (intra-cell edges)
    if (cp.curveType !== "none") return true

    const { x: cx, y: cy } = cp.center
    const q = cp.quadrant

    // Determine which edge-midpoint this line connects to (the non-center endpoint)
    const e0x = parseFloat(cp.ends[0].x)
    const e0y = parseFloat(cp.ends[0].y)
    const e1x = parseFloat(cp.ends[1].x)
    const e1y = parseFloat(cp.ends[1].y)

    // Find the endpoint that's NOT the cell center
    let midX: number, midY: number
    if (e0x === cx && e0y === cy) {
      midX = e1x; midY = e1y
    } else if (e1x === cx && e1y === cy) {
      midX = e0x; midY = e0y
    } else {
      // Neither endpoint is at cell center — this is a diagonal or corner edge.
      // Check if it's between cell center and a corner (e.g., for weird overrides).
      // For now, keep it (don't eliminate).
      return true
    }

    // Determine which adjacent quadrant is on the other side of this edge.
    // Edge-midpoint positions and the adjacent quadrant:
    //   tc (cx, cy-0.5): between NW(2) and NE(3)
    //   bc (cx, cy+0.5): between SW(1) and SE(0)
    //   cl (cx-0.5, cy): between NW(2) and SW(1)
    //   cr (cx+0.5, cy): between NE(3) and SE(0)
    let adjacentQuadrant: Quadrant | null = null

    if (midX === cx && midY === cy - 0.5) {
      // tc: between NW(2) and NE(3)
      adjacentQuadrant = q === 2 ? 3 : q === 3 ? 2 : null
    } else if (midX === cx && midY === cy + 0.5) {
      // bc: between SW(1) and SE(0)
      adjacentQuadrant = q === 0 ? 1 : q === 1 ? 0 : null
    } else if (midX === cx - 0.5 && midY === cy) {
      // cl: between NW(2) and SW(1)
      adjacentQuadrant = q === 1 ? 2 : q === 2 ? 1 : null
    } else if (midX === cx + 0.5 && midY === cy) {
      // cr: between NE(3) and SE(0)
      adjacentQuadrant = q === 0 ? 3 : q === 3 ? 0 : null
    }

    if (adjacentQuadrant !== null) {
      const adjKey = `${cx},${cy}:${adjacentQuadrant}`
      if (filledQuadrants.has(adjKey)) {
        return false // Internal: both quadrants filled
      }
    }

    return true // Boundary: keep
  })
}

/**
 * Path stitcher using an endpoint index for O(1) lookups.
 * Chains CurvePrimitives into closed loops by matching SubgridPoint endpoints.
 *
 * Uses bidirectional stitching: when forward extension is blocked, tries to
 * extend the path backward (prepend to the front) so that concave features
 * inside a shape get stitched into the main boundary path rather than
 * remaining as isolated sub-paths.
 */
function createOrderedPathsIndexed(
  curvePrimitives: CurvePrimitive[],
): CurvePrimitive[][] {
  if (curvePrimitives.length === 0) return []

  const pointKey = (p: SubgridPoint) => `${p.x},${p.y}`

  // Build endpoint index: Map<endpointKey, list of {index, whichEnd}>
  const endpointIndex = new Map<string, { idx: number; end: 0 | 1 }[]>()

  for (let i = 0; i < curvePrimitives.length; i++) {
    const cp = curvePrimitives[i]
    for (const end of [0, 1] as const) {
      const key = pointKey(cp.ends[end])
      let list = endpointIndex.get(key)
      if (!list) {
        list = []
        endpointIndex.set(key, list)
      }
      list.push({ idx: i, end })
    }
  }

  const used = new Set<number>()
  const paths: CurvePrimitive[][] = []

  for (let startIdx = 0; startIdx < curvePrimitives.length; startIdx++) {
    if (used.has(startIdx)) continue

    const path: CurvePrimitive[] = []
    used.add(startIdx)

    // Orient the first primitive
    const first = curvePrimitives[startIdx]
    path.push({
      ...first,
      ends: [first.ends[0], first.ends[1]],
    })

    let safety = 0
    while (safety++ < 99999) {
      // --- Forward extension: append to path end ---
      const lastEnd = path[path.length - 1].ends[1]
      const endKey = pointKey(lastEnd)
      const forwardCandidates = endpointIndex.get(endKey)

      let forwardFound = false
      if (forwardCandidates) {
        for (const { idx, end } of forwardCandidates) {
          if (used.has(idx)) continue

          used.add(idx)
          const cp = curvePrimitives[idx]

          // Orient: if the matching end is end[1], we need to flip
          if (end === 0) {
            path.push({ ...cp, ends: [cp.ends[0], cp.ends[1]] })
          } else {
            path.push({ ...cp, ends: [cp.ends[1], cp.ends[0]] })
          }
          forwardFound = true
          break
        }
      }

      if (forwardFound) continue

      // Check if path is already closed (last end == first start)
      const firstStart = path[0].ends[0]
      if (pointKey(lastEnd) === pointKey(firstStart)) break

      // --- Backward extension: prepend to path start ---
      const pathStart = path[0].ends[0]
      const startKey = pointKey(pathStart)
      const backwardCandidates = endpointIndex.get(startKey)

      let backwardFound = false
      if (backwardCandidates) {
        for (const { idx, end } of backwardCandidates) {
          if (used.has(idx)) continue

          used.add(idx)
          const cp = curvePrimitives[idx]

          // Prepend: orient so this primitive ends at pathStart
          // If end[1] matches pathStart, use as-is (ends[0] → pathStart = ends[1])
          // If end[0] matches pathStart, flip it (ends[1] → pathStart = ends[0] reversed)
          const oriented: CurvePrimitive = end === 1
            ? { ...cp, ends: [cp.ends[0], cp.ends[1]] }
            : { ...cp, ends: [cp.ends[1], cp.ends[0]] }
          path.unshift(oriented)
          backwardFound = true
          break
        }
      }

      if (!backwardFound) break
    }

    if (path.length >= 3) {
      paths.push(ensureClockwiseOrder(path))
    } else if (path.length > 0) {
      // Small/degenerate paths: include as-is
      paths.push(path)
    }
  }

  return paths
}

/**
 * Generate CCW circular SVG paths for cutouts.
 */
function generateCutoutPaths(
  pointModifications: Map<string, PointModifications> | undefined,
  mmPerUnit: number = 1,
): string[] {
  if (!pointModifications) return []

  const paths: string[] = []
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()

  for (const [pointKey, mods] of pointModifications) {
    if (!mods.cutouts || mods.cutouts.length === 0) continue

    const [px, py] = pointKey.split(",").map(Number)

    for (const cutout of mods.cutouts) {
      const anchorOffset = cutout.anchor === "custom"
        ? (cutout.customOffset ?? { x: 0, y: 0 })
        : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
      const cx = px + anchorOffset.x + (cutout.offset?.x ?? 0)
      const cy = py + anchorOffset.y + (cutout.offset?.y ?? 0)
      const r = cutout.diameterMm / 2 / mmPerUnit

      // CCW circle as two half-arcs (sweep-flag = 0 for CCW)
      paths.push(
        `M ${fmt(cx + r)} ${fmt(cy)} ` +
        `A ${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(cx - r)} ${fmt(cy)} ` +
        `A ${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(cx + r)} ${fmt(cy)} Z`
      )
    }
  }

  return paths
}

export interface SvgRenderDebugInfo {
  blobPrimitives: BlobPrimitive[]
  afterConversion: CurvePrimitive[]
  afterInternalEdgeElimination: CurvePrimitive[]
  afterIntraCellEdgeElimination: CurvePrimitive[]
  stitchedPaths: CurvePrimitive[][]
  svgPaths: string[]
}

export class SvgPathRenderer extends Renderer {
  private _lastDebugInfo: SvgRenderDebugInfo | null = null

  constructor(debugMode = false) {
    super(debugMode)
  }

  /** Returns debug info from the most recent renderLayer call. Only populated when debugMode=true. */
  getLastDebugInfo(): SvgRenderDebugInfo | null {
    return this._lastDebugInfo
  }

  // Not used (SVG is string-based), but we keep the signature
  clear(): void {}

  renderComposite(geometry: CompositeGeometry, options: RenderOptions): string {
    const mmPerUnit = options.mmPerUnit ?? 1
    const layerSvgs = geometry.layers.map((lg) =>
      this.renderLayer(lg.geometry, options.style, options.transform, lg.layer, mmPerUnit),
    )

    const content = layerSvgs.filter(Boolean).join("\n")

    // Calculate viewport from bounding box (using subgrid coordinates directly)
    const { min, max } = geometry.boundingBox
    const viewW = Math.max(1, Math.ceil(max.x - min.x + 1))
    const viewH = Math.max(1, Math.ceil(max.y - min.y + 1))

    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min.x} ${min.y} ${viewW} ${viewH}">\n${content}\n</svg>`
  }

  renderLayer(
    geometry: BlobGeometry,
    style: RenderStyle,
    transform: ViewportTransform,
    layer?: GridLayer,
    mmPerUnit: number = 1,
  ): string {
    // Step 1: Convert BlobPrimitives to CurvePrimitives.
    // Filter out interior rectangles (curveType="none") — those with no exposed edges.
    // For roundedCorner/bridge, blobPrimitiveToCurvePrimitives emits all boundary
    // edges (arc + lines), including intra-cell edges with curveType="none".
    const afterConversion: CurvePrimitive[] = geometry.primitives
      .filter((primitive) => primitive.curveType !== "none")
      .flatMap((primitive) => blobPrimitiveToCurvePrimitives(primitive))

    // Step 2a: Eliminate internal cell-boundary edges (line-* between adjacent cells)
    const afterInternalEdgeElimination = eliminateInternalEdges(afterConversion, geometry.primitives)

    // Step 2b: Eliminate internal intra-cell edges (center↔midpoint between quadrants)
    const afterIntraCellEdgeElimination = eliminateIntraCellEdges(afterInternalEdgeElimination, geometry.primitives)

    // Step 2c: Remove any remaining "none"-typed primitives that survived elimination
    // (these are intra-cell edges on the boundary — should NOT be filtered for override shapes)
    // Actually, keep them — they're valid boundary edges that need to participate in stitching.
    // The "none" curveType just means they're rendered as straight lines (L command).

    // Step 3: Stitch into closed paths using indexed endpoint lookup
    const stitchedPaths = createOrderedPathsIndexed(afterIntraCellEdgeElimination)

    // Step 4: Convert to SVG path strings
    const svgPaths = curvePrimitiveArraysToSvgPaths(stitchedPaths)

    // Step 5: Generate cutout circle paths
    const cutoutPaths = layer
      ? generateCutoutPaths(layer.pointModifications, mmPerUnit)
      : []

    if (this.debugMode) {
      this._lastDebugInfo = {
        blobPrimitives: geometry.primitives,
        afterConversion,
        afterInternalEdgeElimination,
        afterIntraCellEdgeElimination,
        stitchedPaths,
        svgPaths,
      }
    }

    // Emit SVG paths
    const stroke = style.strokeColor || style.fillColor || "#000"
    const strokeWidth = style.strokeWidth ?? 0.05
    const opacity = style.opacity ?? 1
    const fill = style.fillColor || "none"

    const allPaths = [...svgPaths, ...cutoutPaths]
    const pathElements = allPaths
      .map((path) => `  <path d="${path}" />`)
      .join("\n")

    return `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}">\n${pathElements}\n</g>`
  }

  renderPrimitive(): void {
    // Not used for SVG path merging; we render whole layers.
  }
}
