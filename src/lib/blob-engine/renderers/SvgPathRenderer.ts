/**
 * SvgPathRenderer
 *
 * A clean-room SVG path renderer built around a simple edge-bag algorithm:
 *
 *  1. For every BlobPrimitive, emit the FULL perimeter of that primitive's shape
 *     as a list of oriented segments (lines and quarter-circle arcs).
 *
 *  2. Collect all segments into a "bag".
 *     - Line segments are keyed canonically (smaller endpoint first); a segment
 *       that appears twice (contributed by two adjacent filled regions from
 *       opposite sides) is an internal edge → remove both occurrences.
 *     - Arc segments are keyed by their geometry; a convex arc and the matching
 *       concave arc at the same location cancel each other.
 *
 *  3. Stitch the surviving segments into closed loops by chaining endpoints.
 *
 *  4. Emit one SVG <path> subpath per loop (M … arc/line … Z).
 *
 * Because all endpoints live on a half-integer subgrid (multiples of 0.5) we
 * can represent coordinates exactly as multiples of 0.5 and use integer keys
 * (storing 2× the coordinate to avoid floating-point issues).
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  CompositeGeometry,
  GridLayer,
  RenderStyle,
} from "../types"
import type { PointModifications } from "@/types/gridpaint"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"
import {
  Renderer,
  type RenderOptions,
  type ViewportTransform,
} from "./Renderer"

// ---------------------------------------------------------------------------
// Internal geometry types
// ---------------------------------------------------------------------------

/** A point stored as 2× the subgrid coordinate (always integers). */
interface Pt {
  x2: number // x * 2
  y2: number // y * 2
}

/** A straight line segment from `a` to `b`. */
interface LineEdge {
  kind: "line"
  a: Pt
  b: Pt
}

/**
 * A quarter-circle arc from `a` to `b`.
 *
 * `center` is the center of the circle (radius is always 0.5 grid units).
 * `sweep` is the SVG sweep-flag (1 = CW, 0 = CCW in screen coordinates
 *  where y+ is down).
 */
interface ArcEdge {
  kind: "arc"
  a: Pt
  b: Pt
  center: Pt
  sweep: 0 | 1
}

type Edge = LineEdge | ArcEdge

// ---------------------------------------------------------------------------
// Debug info
// ---------------------------------------------------------------------------

export interface PrimitiveEdgeDebugInfo {
  primitive: BlobPrimitive
  edges: Edge[]
}

export interface SvgPathRendererDebugInfo {
  /** Raw edges emitted per primitive (before deduplication). */
  primitiveEdges: PrimitiveEdgeDebugInfo[]
  /** All edges collected from all primitives. */
  allEdges: Edge[]
  /** Edges surviving deduplication (boundary edges only). */
  boundaryEdges: Edge[]
  /** Edges grouped into closed paths. */
  stitchedPaths: Edge[][]
  /** Final SVG path strings. */
  svgPaths: string[]
  /** Edge count stats. */
  stats: {
    totalEdges: number
    cancelledEdges: number
    boundaryEdges: number
    pathCount: number
  }
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number): Pt {
  // x and y are in subgrid units (multiples of 0.5).
  // Store 2× to keep them as integers.
  return { x2: Math.round(x * 2), y2: Math.round(y * 2) }
}

function ptKey(p: Pt): string {
  return `${p.x2},${p.y2}`
}

function ptEq(a: Pt, b: Pt): boolean {
  return a.x2 === b.x2 && a.y2 === b.y2
}

function ptToSvg(p: Pt): string {
  const x = p.x2 / 2
  const y = p.y2 / 2
  return `${fmtN(x)} ${fmtN(y)}`
}

function fmtN(n: number): string {
  return (Math.round(n * 1000) / 1000).toString()
}

function ptToString(p: Pt): string {
  return `(${p.x2 / 2}, ${p.y2 / 2})`
}

function edgeToString(e: Edge): string {
  if (e.kind === "line") {
    return `line ${ptToString(e.a)}→${ptToString(e.b)}`
  } else {
    return `arc  ${ptToString(e.a)}→${ptToString(e.b)} center=${ptToString(e.center)} sweep=${e.sweep}`
  }
}

// ---------------------------------------------------------------------------
// Arc sweep calculation
//
// In SVG / screen space (y+ down), sweep-flag=1 means clockwise.
// Given arc center, start point, and end point, compute the sweep flag
// such that the arc traverses the shorter quarter of the circle in the
// direction consistent with the CW perimeter we want.
// ---------------------------------------------------------------------------

/**
 * Compute the SVG sweep flag for an arc going from `a` to `b` around `center`.
 *
 * The cross-product of (a→center) × (a→b) tells us which side of the line AB
 * the center is on. If center is to the LEFT of a→b the arc is CCW (sweep=0);
 * if center is to the RIGHT the arc is CW (sweep=1).
 */
function arcSweep(a: Pt, b: Pt, center: Pt): 0 | 1 {
  // Cross product of (center - a) × (b - a), z-component.
  // In screen space (y+ down), positive cross product means center is to the RIGHT
  // of the directed line a→b, which corresponds to CW traversal (sweep=1 in SVG).
  const acx = center.x2 - a.x2
  const acy = center.y2 - a.y2
  const abx = b.x2 - a.x2
  const aby = b.y2 - a.y2
  const cross = acx * aby - acy * abx
  return cross > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Quadrant corner system
//
// Each quadrant of a grid cell (cx, cy) has four named corners in subgrid
// coordinates. We define these for the canonical SE quadrant and rotate for
// other quadrants.
//
// Local quadrant "role" names (CW traversal order for a filled quadrant):
//   TL = inner corner   = cell center
//   TR = first edge midpoint (clockwise from TL)
//   BR = outer corner
//   BL = second edge midpoint
//
// Mapping to absolute subgrid coordinates:
//   Q0 (SE): TL=(cx,cy),     TR=(cx+0.5,cy),  BR=(cx+0.5,cy+0.5), BL=(cx,cy+0.5)
//   Q1 (SW): TL=(cx,cy),     TR=(cx,cy+0.5),  BR=(cx-0.5,cy+0.5), BL=(cx-0.5,cy)
//   Q2 (NW): TL=(cx,cy),     TR=(cx-0.5,cy),  BR=(cx-0.5,cy-0.5), BL=(cx,cy-0.5)
//   Q3 (NE): TL=(cx,cy),     TR=(cx,cy-0.5),  BR=(cx+0.5,cy-0.5), BL=(cx+0.5,cy)
// ---------------------------------------------------------------------------

interface QuadrantCorners {
  TL: Pt // inner corner (cell center)
  TR: Pt // first edge midpoint (CW from TL)
  BR: Pt // outer corner
  BL: Pt // second edge midpoint
}

function getQuadrantCorners(
  cx: number,
  cy: number,
  quadrant: 0 | 1 | 2 | 3,
): QuadrantCorners {
  switch (quadrant) {
    case 0: // SE
      return {
        TL: pt(cx, cy),
        TR: pt(cx + 0.5, cy),
        BR: pt(cx + 0.5, cy + 0.5),
        BL: pt(cx, cy + 0.5),
      }
    case 1: // SW
      return {
        TL: pt(cx, cy),
        TR: pt(cx, cy + 0.5),
        BR: pt(cx - 0.5, cy + 0.5),
        BL: pt(cx - 0.5, cy),
      }
    case 2: // NW
      return {
        TL: pt(cx, cy),
        TR: pt(cx - 0.5, cy),
        BR: pt(cx - 0.5, cy - 0.5),
        BL: pt(cx, cy - 0.5),
      }
    case 3: // NE
      return {
        TL: pt(cx, cy),
        TR: pt(cx, cy - 0.5),
        BR: pt(cx + 0.5, cy - 0.5),
        BL: pt(cx + 0.5, cy),
      }
  }
}

// ---------------------------------------------------------------------------
// Primitive → perimeter edges
//
// For each BlobPrimitive, emit the CW-oriented perimeter of the filled shape.
//
// relOffset = (renderQuadrant - quadrant) mod 4 determines which corner of the
// local quadrant box is the "outer" (arc) corner:
//   relOffset 0 → outer = BR  (natural orientation)
//   relOffset 1 → outer = BL
//   relOffset 2 → outer = TL
//   relOffset 3 → outer = TR
//
// roundedCorner (convex): arc from TR→BL curving toward the outer corner;
//   two straight edges TL→TR and BL→TL.
//
// diagonalBridge (concave): same arc geometry as convex but OPPOSITE sweep
//   (fills the triangular corner region); two straight edges through the
//   outer corner: BL→BR and BR→TR (at relOffset 0, etc.)
// ---------------------------------------------------------------------------

function getRelOffset(primitive: BlobPrimitive): number {
  const rq = primitive.renderQuadrant ?? primitive.quadrant
  return (((rq - primitive.quadrant) % 4) + 4) % 4
}

/**
 * Emit the CW-oriented perimeter edges for a single BlobPrimitive.
 */
function primitiveToEdges(primitive: BlobPrimitive): Edge[] {
  const { TL, TR, BR, BL } = getQuadrantCorners(
    primitive.center.x,
    primitive.center.y,
    primitive.quadrant,
  )

  if (primitive.type === "rectangle") {
    // Full quadrant box: TL→TR→BR→BL→TL
    return [
      { kind: "line", a: TL, b: TR },
      { kind: "line", a: TR, b: BR },
      { kind: "line", a: BR, b: BL },
      { kind: "line", a: BL, b: TL },
    ]
  }

  const relOffset = getRelOffset(primitive)

  if (primitive.type === "roundedCorner") {
    // Convex arc: the arc bulges outward (away from TL, toward BR).
    // Arc center is BR (the outer corner), radius = 0.5.
    // arcSweep(TR, BL, BR) returns 1 (CW = concave), so we XOR to get 0 (CCW = convex).
    switch (relOffset) {
      case 0:
        // outer=BR: arc TR→BL (CCW, convex toward BR), lines TL→TR and BL→TL
        return [
          { kind: "line", a: TL, b: TR },
          {
            kind: "arc",
            a: TR,
            b: BL,
            center: BR,
            sweep: (1 - (arcSweep(TR, BL, BR) ^ 1)) as 0 | 1,
          },
          { kind: "line", a: BL, b: TL },
        ]
      case 1:
        // outer=BL: arc TL→BR (CCW, convex toward BL), lines TR→TL and BR→TR
        return [
          { kind: "line", a: TR, b: TL },
          {
            kind: "arc",
            a: TL,
            b: BR,
            center: BL,
            sweep: (1 - (arcSweep(TL, BR, BL) ^ 1)) as 0 | 1,
          },
          { kind: "line", a: BR, b: TR },
        ]
      case 2:
        // outer=TL: arc BL→TR (CCW, convex toward TL), lines BR→BL and TR→BR
        return [
          { kind: "line", a: BR, b: BL },
          {
            kind: "arc",
            a: BL,
            b: TR,
            center: TL,
            sweep: (1 - (arcSweep(BL, TR, TL) ^ 1)) as 0 | 1,
          },
          { kind: "line", a: TR, b: BR },
        ]
      case 3:
        // outer=TR: arc BR→TL (CCW, convex toward TR), lines BL→BR and TL→BL
        return [
          { kind: "line", a: BL, b: BR },
          {
            kind: "arc",
            a: BR,
            b: TL,
            center: TR,
            sweep: (1 - (arcSweep(BR, TL, TR) ^ 1)) as 0 | 1,
          },
          { kind: "line", a: TL, b: BL },
        ]
    }
  }

  if (primitive.type === "diagonalBridge") {
    // Concave: fills the outer triangular corner region.
    // Arc center is BR (the outer corner); arcSweep returns 1 (CW = concave inward).
    // Then two straight lines through the outer corner complete the shape.
    switch (relOffset) {
      case 0:
        // outer=BR: arc TR→BL (CW, concave toward BR), then BL→BR→TR
        return [
          {
            kind: "arc",
            a: TR,
            b: BL,
            center: BR,
            sweep: arcSweep(TR, BL, BR),
          },
          { kind: "line", a: BL, b: BR },
          { kind: "line", a: BR, b: TR },
        ]
      case 1:
        // outer=BL: arc TL→BR (CW, concave toward BL), then BR→BL→TL
        return [
          {
            kind: "arc",
            a: TL,
            b: BR,
            center: BL,
            sweep: arcSweep(TL, BR, BL),
          },
          { kind: "line", a: BR, b: BL },
          { kind: "line", a: BL, b: TL },
        ]
      case 2:
        // outer=TL: arc BL→TR (CW, concave toward TL), then TR→TL→BL
        return [
          {
            kind: "arc",
            a: BL,
            b: TR,
            center: TL,
            sweep: arcSweep(BL, TR, TL),
          },
          { kind: "line", a: TR, b: TL },
          { kind: "line", a: TL, b: BL },
        ]
      case 3:
        // outer=TR: arc BR→TL (CW, concave toward TR), then TL→TR→BR
        return [
          {
            kind: "arc",
            a: BR,
            b: TL,
            center: TR,
            sweep: arcSweep(BR, TL, TR),
          },
          { kind: "line", a: TL, b: TR },
          { kind: "line", a: TR, b: BR },
        ]
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Edge deduplication
//
// Each edge is keyed canonically (sorted endpoints). A line appearing twice
// (contributed by two adjacent filled regions in opposite orientations) is an
// internal edge → cancel both. Similarly for arcs.
// ---------------------------------------------------------------------------

function lineKey(a: Pt, b: Pt): string {
  const ak = ptKey(a)
  const bk = ptKey(b)
  return ak < bk ? `L:${ak}:${bk}` : `L:${bk}:${ak}`
}

function arcKey(a: Pt, b: Pt, center: Pt): string {
  const ak = ptKey(a)
  const bk = ptKey(b)
  const ck = ptKey(center)
  return ak < bk ? `A:${ak}:${bk}:${ck}` : `A:${bk}:${ak}:${ck}`
}

/**
 * Deduplicate edges: cancel internal edges that appear an even number of times.
 * Returns only boundary edges (odd count).
 */
function deduplicateEdges(edges: Edge[], debugMode: boolean): Edge[] {
  const counts = new Map<string, number>()
  const representatives = new Map<string, Edge>()

  for (const edge of edges) {
    let key: string

    if (edge.kind === "line") {
      key = lineKey(edge.a, edge.b)
    } else {
      key = arcKey(edge.a, edge.b, edge.center)
    }

    const prev = counts.get(key) ?? 0
    counts.set(key, prev + 1)

    if (!representatives.has(key)) {
      representatives.set(key, edge)
    }
  }

  if (debugMode) {
    let cancelled = 0
    for (const [key, count] of counts) {
      if (count % 2 === 0) {
        cancelled += count
        console.log(
          `[SvgPathRenderer] CANCEL (×${count}): ${edgeToString(representatives.get(key)!)}`,
        )
      }
    }
    console.log(
      `[SvgPathRenderer] dedup: ${edges.length} total → ${cancelled} cancelled → ${edges.length - cancelled} boundary`,
    )
  }

  const result: Edge[] = []
  for (const [key, count] of counts) {
    if (count % 2 === 1) {
      result.push(representatives.get(key)!)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Path stitching
//
// Given a bag of boundary edges, chain them into closed loops.
// Each edge can be traversed forward (a→b) or backward (b→a).
// ---------------------------------------------------------------------------

function stitchEdgesIntoPaths(edges: Edge[], debugMode: boolean): Edge[][] {
  if (edges.length === 0) return []

  // Build adjacency index: startKey → list of {edgeIdx, flip}
  type EdgeRef = { idx: number; flip: boolean }
  const startIndex = new Map<string, EdgeRef[]>()

  const addRef = (key: string, ref: EdgeRef) => {
    let list = startIndex.get(key)
    if (!list) {
      list = []
      startIndex.set(key, list)
    }
    list.push(ref)
  }

  for (let i = 0; i < edges.length; i++) {
    // Each edge can be entered from either end
    addRef(ptKey(edges[i].a), { idx: i, flip: false })
    addRef(ptKey(edges[i].b), { idx: i, flip: true })
  }

  const used = new Array<boolean>(edges.length).fill(false)
  const paths: Edge[][] = []

  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used[startIdx]) continue

    used[startIdx] = true
    const path: Edge[] = [edges[startIdx]]

    if (debugMode) {
      console.log(
        `[SvgPathRenderer] starting path from edge ${startIdx}: ${edgeToString(edges[startIdx])}`,
      )
    }

    let safety = 0
    while (safety++ < 100000) {
      const currentEnd = path[path.length - 1].b

      // Check if path is closed
      if (path.length > 1 && ptEq(currentEnd, path[0].a)) {
        if (debugMode)
          console.log(`[SvgPathRenderer]   → closed after ${path.length} edges`)
        break
      }

      // Find unused edge starting from currentEnd
      const candidates = startIndex.get(ptKey(currentEnd))
      let found = false

      if (candidates) {
        for (const { idx, flip } of candidates) {
          if (used[idx]) continue
          used[idx] = true

          const edge = edges[idx]
          let oriented: Edge
          if (!flip) {
            oriented = edge
          } else {
            // Flip the edge so it starts at currentEnd
            if (edge.kind === "line") {
              oriented = { kind: "line", a: edge.b, b: edge.a }
            } else {
              oriented = {
                kind: "arc",
                a: edge.b,
                b: edge.a,
                center: edge.center,
                sweep: (edge.sweep ^ 1) as 0 | 1,
              }
            }
          }

          path.push(oriented)
          found = true

          if (debugMode) {
            console.log(`[SvgPathRenderer]   + ${edgeToString(oriented)}`)
          }
          break
        }
      }

      if (!found) {
        if (debugMode) {
          console.log(
            `[SvgPathRenderer]   → STUCK at ${ptToString(currentEnd)} (${path.length} edges, open path)`,
          )
        }
        break
      }
    }

    if (path.length >= 2) {
      paths.push(path)
    }
  }

  return paths
}

// ---------------------------------------------------------------------------
// SVG path string generation
// ---------------------------------------------------------------------------

function pathToSvgString(path: Edge[]): string {
  if (path.length === 0) return ""

  const parts: string[] = []
  parts.push(`M ${ptToSvg(path[0].a)}`)

  for (const edge of path) {
    if (edge.kind === "line") {
      parts.push(`L ${ptToSvg(edge.b)}`)
    } else {
      // SVG Arc: A rx ry x-rotation large-arc-flag sweep-flag x y
      // Radius is always 0.5 (quarter circle of a grid cell's quadrant)
      const r = fmtN(0.5)
      parts.push(`A ${r} ${r} 0 0 ${edge.sweep} ${ptToSvg(edge.b)}`)
    }
  }

  parts.push("Z")
  return parts.join(" ")
}

// ---------------------------------------------------------------------------
// Cutout path generation (CCW circles for laser cutter hole paths)
// ---------------------------------------------------------------------------

function generateCutoutPaths(
  pointModifications: Map<string, PointModifications> | undefined,
  mmPerUnit: number = 1,
): string[] {
  if (!pointModifications) return []

  const paths: string[] = []

  for (const [pointKey, mods] of pointModifications) {
    if (!mods.cutouts || mods.cutouts.length === 0) continue

    const [px, py] = pointKey.split(",").map(Number)

    for (const cutout of mods.cutouts) {
      const anchorOffset =
        cutout.anchor === "custom"
          ? (cutout.customOffset ?? { x: 0, y: 0 })
          : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
      const cx = px + anchorOffset.x + (cutout.offset?.x ?? 0)
      const cy = py + anchorOffset.y + (cutout.offset?.y ?? 0)
      const r = cutout.diameterMm / 2 / mmPerUnit

      // CCW circle as two half-arcs (sweep-flag=0 for CCW)
      paths.push(
        `M ${fmtN(cx + r)} ${fmtN(cy)} ` +
          `A ${fmtN(r)} ${fmtN(r)} 0 0 0 ${fmtN(cx - r)} ${fmtN(cy)} ` +
          `A ${fmtN(r)} ${fmtN(r)} 0 0 0 ${fmtN(cx + r)} ${fmtN(cy)} Z`,
      )
    }
  }

  return paths
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

export class SvgPathRenderer extends Renderer {
  private _lastDebugInfo: SvgPathRendererDebugInfo | null = null

  constructor(debugMode = false) {
    super(debugMode)
  }

  /** Returns debug info from the most recent renderLayer call. Only populated when debugMode=true. */
  getLastDebugInfo(): SvgPathRendererDebugInfo | null {
    return this._lastDebugInfo
  }

  clear(): void {}

  renderComposite(geometry: CompositeGeometry, options: RenderOptions): string {
    const mmPerUnit = options.mmPerUnit ?? 1
    const layerSvgs = geometry.layers.map((lg) =>
      this.renderLayer(
        lg.geometry,
        options.style,
        options.transform,
        lg.layer,
        mmPerUnit,
      ),
    )

    const content = layerSvgs.filter(Boolean).join("\n")

    const { min, max } = geometry.boundingBox
    const viewW = Math.max(1, Math.ceil(max.x - min.x + 1))
    const viewH = Math.max(1, Math.ceil(max.y - min.y + 1))

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min.x - 0.5} ${min.y - 0.5} ${viewW + 1} ${viewH + 1}">\n` +
      `${content}\n` +
      `</svg>`
    )
  }

  renderLayer(
    geometry: BlobGeometry,
    style: RenderStyle,
    _transform: ViewportTransform,
    layer?: GridLayer,
    mmPerUnit: number = 1,
  ): string {
    const dbg = this.debugMode

    if (dbg) {
      console.log(
        `\n[SvgPathRenderer] ── renderLayer ──────────────────────────`,
      )
      console.log(
        `[SvgPathRenderer] primitives (${geometry.primitives.length}):`,
      )
      for (const p of geometry.primitives) {
        const rq =
          p.renderQuadrant !== undefined ? ` renderQ=${p.renderQuadrant}` : ""
        console.log(
          `[SvgPathRenderer]   ${p.type.padEnd(16)} q${p.quadrant}${rq}  @ (${p.center.x},${p.center.y})  curveType=${p.curveType}`,
        )
      }
    }

    // ── Step 1: Emit perimeter edges for each primitive ──────────────────────
    const primitiveEdges: PrimitiveEdgeDebugInfo[] = []
    const allEdges: Edge[] = []

    for (const primitive of geometry.primitives) {
      const edges = primitiveToEdges(primitive)
      primitiveEdges.push({ primitive, edges })
      allEdges.push(...edges)

      if (dbg) {
        const relOffset = getRelOffset(primitive)
        console.log(
          `[SvgPathRenderer] → ${primitive.type} q${primitive.quadrant} relOffset=${relOffset} @ (${primitive.center.x},${primitive.center.y}) → ${edges.length} edges:`,
        )
        for (const e of edges) {
          console.log(`[SvgPathRenderer]     ${edgeToString(e)}`)
        }
      }
    }

    if (dbg) {
      console.log(`[SvgPathRenderer] total raw edges: ${allEdges.length}`)
    }

    // ── Step 2: Deduplicate (cancel internal/shared edges) ───────────────────
    const boundaryEdges = deduplicateEdges(allEdges, dbg)

    if (dbg) {
      console.log(`[SvgPathRenderer] boundary edges (${boundaryEdges.length}):`)
      for (const e of boundaryEdges) {
        console.log(`[SvgPathRenderer]   ${edgeToString(e)}`)
      }
    }

    // ── Step 3: Stitch into closed loops ─────────────────────────────────────
    const stitchedPaths = stitchEdgesIntoPaths(boundaryEdges, dbg)

    if (dbg) {
      console.log(
        `[SvgPathRenderer] stitched into ${stitchedPaths.length} path(s):`,
      )
      for (let i = 0; i < stitchedPaths.length; i++) {
        const p = stitchedPaths[i]
        const closed = p.length > 1 && ptEq(p[p.length - 1].b, p[0].a)
        console.log(
          `[SvgPathRenderer]   path[${i}] ${p.length} edges, ${closed ? "CLOSED" : "OPEN"}`,
        )
      }
    }

    // ── Step 4: Convert to SVG path strings ──────────────────────────────────
    const svgPaths = stitchedPaths.map(pathToSvgString).filter(Boolean)

    // ── Step 5: Add cutout circles ────────────────────────────────────────────
    const cutoutPaths = layer
      ? generateCutoutPaths(layer.pointModifications, mmPerUnit)
      : []

    if (dbg) {
      console.log(`[SvgPathRenderer] SVG paths (${svgPaths.length}):`)
      for (const p of svgPaths) {
        console.log(`[SvgPathRenderer]   ${p}`)
      }
      if (cutoutPaths.length > 0) {
        console.log(`[SvgPathRenderer] cutout paths (${cutoutPaths.length}):`)
        for (const p of cutoutPaths) {
          console.log(`[SvgPathRenderer]   ${p}`)
        }
      }
      console.log(
        `[SvgPathRenderer] ─────────────────────────────────────────\n`,
      )
    }

    if (this.debugMode) {
      this._lastDebugInfo = {
        primitiveEdges,
        allEdges,
        boundaryEdges,
        stitchedPaths,
        svgPaths,
        stats: {
          totalEdges: allEdges.length,
          cancelledEdges: allEdges.length - boundaryEdges.length,
          boundaryEdges: boundaryEdges.length,
          pathCount: stitchedPaths.length,
        },
      }
    }

    // ── Step 6: Emit SVG group ────────────────────────────────────────────────
    const stroke = style.strokeColor || style.fillColor || "#000"
    const strokeWidth = style.strokeWidth ?? 0.5
    const opacity = style.opacity ?? 1
    const fill = style.fillColor || "none"

    const allPaths = [...svgPaths, ...cutoutPaths]
    const pathElements = allPaths.map((d) => `  <path d="${d}" />`).join("\n")

    return (
      `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}">\n` +
      `${pathElements}\n` +
      `</g>`
    )
  }

  renderPrimitive(): void {
    // Not used for SVG path merging
  }
}
