/**
 * DxfRenderer
 *
 * Produces a DXF file from BlobGeometry using the same edge-bag algorithm as
 * SvgPathRenderer.
 *
 * Two output modes are supported, controlled by USE_LEGACY_POLYLINE:
 *
 *  FALSE (default) — R2000 / AC1015 mode:
 *    Uses LWPOLYLINE with inline bulge values for arcs.
 *    Broad support among modern CAD/CAM tools.
 *
 *  TRUE — AC1009 legacy mode:
 *    Uses POLYLINE + VERTEX + SEQEND (the old-style entity set).
 *    All arcs are tessellated into straight-line segments so that
 *    even the simplest DXF viewers (web-based, lightweight) render
 *    the geometry correctly.  Segment density is scale-aware: larger
 *    exports get more segments per quarter-circle so tessellation is
 *    never visible in the final product.
 *
 * Both modes:
 *   • Include $EXTMIN / $EXTMAX so viewers auto-fit on open.
 *   • Use ENDTAB (correct AC1009 terminator, also valid in AC1015).
 *   • Translate all coordinates so the bounding box starts at (0, 0).
 *   • Output coordinates in mm (subgrid_coord × mmPerUnit).
 *
 * Coordinates are output in mm: subgrid_coord × mmPerUnit.
 * (Subgrid units are already half-gridcell units; the conversion factor covers
 *  the full chain: raw subgrid → physical mm.)
 */

import type { BlobGeometry, BlobPrimitive, GridLayer } from "../types"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"
import type { PointModifications } from "@/types/gridpaint"

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

/**
 * Set to `true` to emit AC1009-compatible POLYLINE/VERTEX/SEQEND entities
 * with fully tessellated arcs (broadest viewer compatibility).
 * Set to `false` to emit modern AC1015 LWPOLYLINE with bulge-encoded arcs.
 */
export const USE_LEGACY_POLYLINE = true

// ---------------------------------------------------------------------------
// Internal geometry types (mirrors SvgPathRenderer internals)
// ---------------------------------------------------------------------------

/** A point stored as 2× the subgrid coordinate (always integers). */
interface Pt {
  x2: number
  y2: number
}

interface LineEdge {
  kind: "line"
  a: Pt
  b: Pt
}

interface ArcEdge {
  kind: "arc"
  a: Pt
  b: Pt
  /**
   * The outer corner of the quadrant box.  Used for edge dedup keys and
   * as the base for computing the true geometric center at tessellation time.
   * For concave (diagonalBridge) arcs this IS the geometric center.
   * For convex (roundedCorner) arcs, reflect across the chord midpoint
   * to get the geometric center: trueCenter = a + b − center.
   */
  center: Pt
  /** SVG sweep-flag convention: 1=CW (screen y-down), 0=CCW */
  sweep: 0 | 1
  /**
   * Whether the stored `center` needs reflection to obtain the true
   * geometric center of the arc.  true for roundedCorner (convex),
   * false for diagonalBridge (concave).
   *
   * This is a property of the edge's origin primitive and does NOT
   * change when the edge is reversed during path stitching.
   */
  convex: boolean
}

type Edge = LineEdge | ArcEdge

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number): Pt {
  return { x2: Math.round(x * 2), y2: Math.round(y * 2) }
}

function ptKey(p: Pt): string {
  return `${p.x2},${p.y2}`
}

function ptEq(a: Pt, b: Pt): boolean {
  return a.x2 === b.x2 && a.y2 === b.y2
}

// ---------------------------------------------------------------------------
// Arc sweep calculation (identical to SvgPathRenderer)
// ---------------------------------------------------------------------------

function arcSweep(a: Pt, b: Pt, center: Pt): 0 | 1 {
  const acx = center.x2 - a.x2
  const acy = center.y2 - a.y2
  const abx = b.x2 - a.x2
  const aby = b.y2 - a.y2
  const cross = acx * aby - acy * abx
  return cross > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Quadrant corners (identical to SvgPathRenderer)
// ---------------------------------------------------------------------------

interface QuadrantCorners {
  TL: Pt
  TR: Pt
  BR: Pt
  BL: Pt
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
// Primitive → perimeter edges (identical to SvgPathRenderer)
// ---------------------------------------------------------------------------

function getRelOffset(primitive: BlobPrimitive): number {
  const rq = primitive.renderQuadrant ?? primitive.quadrant
  return (((rq - primitive.quadrant) % 4) + 4) % 4
}

function primitiveToEdges(primitive: BlobPrimitive): Edge[] {
  const { TL, TR, BR, BL } = getQuadrantCorners(
    primitive.center.x,
    primitive.center.y,
    primitive.quadrant,
  )

  if (primitive.type === "rectangle") {
    return [
      { kind: "line", a: TL, b: TR },
      { kind: "line", a: TR, b: BR },
      { kind: "line", a: BR, b: BL },
      { kind: "line", a: BL, b: TL },
    ]
  }

  const relOffset = getRelOffset(primitive)

  if (primitive.type === "roundedCorner") {
    switch (relOffset) {
      case 0:
        return [
          { kind: "line", a: TL, b: TR },
          {
            kind: "arc",
            a: TR,
            b: BL,
            center: BR,
            sweep: (1 - (arcSweep(TR, BL, BR) ^ 1)) as 0 | 1,
            convex: true,
          },
          { kind: "line", a: BL, b: TL },
        ]
      case 1:
        return [
          { kind: "line", a: TR, b: TL },
          {
            kind: "arc",
            a: TL,
            b: BR,
            center: BL,
            sweep: (1 - (arcSweep(TL, BR, BL) ^ 1)) as 0 | 1,
            convex: true,
          },
          { kind: "line", a: BR, b: TR },
        ]
      case 2:
        return [
          { kind: "line", a: BR, b: BL },
          {
            kind: "arc",
            a: BL,
            b: TR,
            center: TL,
            sweep: (1 - (arcSweep(BL, TR, TL) ^ 1)) as 0 | 1,
            convex: true,
          },
          { kind: "line", a: TR, b: BR },
        ]
      case 3:
        return [
          { kind: "line", a: BL, b: BR },
          {
            kind: "arc",
            a: BR,
            b: TL,
            center: TR,
            sweep: (1 - (arcSweep(BR, TL, TR) ^ 1)) as 0 | 1,
            convex: true,
          },
          { kind: "line", a: TL, b: BL },
        ]
    }
  }

  if (primitive.type === "diagonalBridge") {
    switch (relOffset) {
      case 0:
        return [
          {
            kind: "arc",
            a: TR,
            b: BL,
            center: BR,
            sweep: arcSweep(TR, BL, BR),
            convex: false,
          },
          { kind: "line", a: BL, b: BR },
          { kind: "line", a: BR, b: TR },
        ]
      case 1:
        return [
          {
            kind: "arc",
            a: TL,
            b: BR,
            center: BL,
            sweep: arcSweep(TL, BR, BL),
            convex: false,
          },
          { kind: "line", a: BR, b: BL },
          { kind: "line", a: BL, b: TL },
        ]
      case 2:
        return [
          {
            kind: "arc",
            a: BL,
            b: TR,
            center: TL,
            sweep: arcSweep(BL, TR, TL),
            convex: false,
          },
          { kind: "line", a: TR, b: TL },
          { kind: "line", a: TL, b: BL },
        ]
      case 3:
        return [
          {
            kind: "arc",
            a: BR,
            b: TL,
            center: TR,
            sweep: arcSweep(BR, TL, TR),
            convex: false,
          },
          { kind: "line", a: TL, b: TR },
          { kind: "line", a: TR, b: BR },
        ]
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Edge deduplication (identical to SvgPathRenderer)
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

function deduplicateEdges(edges: Edge[]): Edge[] {
  const counts = new Map<string, number>()
  const representatives = new Map<string, Edge>()

  for (const edge of edges) {
    const key =
      edge.kind === "line"
        ? lineKey(edge.a, edge.b)
        : arcKey(edge.a, edge.b, edge.center)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (!representatives.has(key)) representatives.set(key, edge)
  }

  const result: Edge[] = []
  for (const [key, count] of counts) {
    if (count % 2 === 1) result.push(representatives.get(key)!)
  }
  return result
}

// ---------------------------------------------------------------------------
// Path stitching (identical to SvgPathRenderer)
// ---------------------------------------------------------------------------

function stitchEdgesIntoPaths(edges: Edge[]): Edge[][] {
  if (edges.length === 0) return []

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
    addRef(ptKey(edges[i].a), { idx: i, flip: false })
    addRef(ptKey(edges[i].b), { idx: i, flip: true })
  }

  const used = new Array<boolean>(edges.length).fill(false)
  const paths: Edge[][] = []

  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used[startIdx]) continue

    used[startIdx] = true
    const path: Edge[] = [edges[startIdx]]

    let safety = 0
    while (safety++ < 100000) {
      const currentEnd = path[path.length - 1].b
      if (path.length > 1 && ptEq(currentEnd, path[0].a)) break

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
            if (edge.kind === "line") {
              oriented = { kind: "line", a: edge.b, b: edge.a }
            } else {
              // Swap endpoints, flip sweep direction.  `convex` is NOT
              // flipped — it indicates whether `center` is the geometric
              // center (false) or needs reflection (true), which is a
              // property of the original primitive, not the traversal order.
              oriented = {
                kind: "arc",
                a: edge.b,
                b: edge.a,
                center: edge.center,
                sweep: (edge.sweep ^ 1) as 0 | 1,
                convex: edge.convex,
              }
            }
          }

          path.push(oriented)
          found = true
          break
        }
      }

      if (!found) break
    }

    if (path.length >= 2) paths.push(path)
  }

  return paths
}

// ---------------------------------------------------------------------------
// Arc tessellation helpers (for AC1009 legacy mode)
// ---------------------------------------------------------------------------

/**
 * Compute the number of segments to use for a quarter-circle arc given the
 * physical radius in mm. The goal is that the maximum chord error (sagitta)
 * is less than MAX_SAGITTA_MM, so tessellation is never visible.
 *
 * sagitta = r × (1 − cos(π / (2n)))
 * Solving for n: n = π / (2 × acos(1 − s/r))
 *
 * We clamp to a minimum of MIN_SEGMENTS_PER_QUARTER and a maximum of
 * MAX_SEGMENTS_PER_QUARTER to avoid degenerate outputs.
 */
const MAX_SAGITTA_MM = 0.05 // 0.05 mm tolerance — invisible in any print
const MIN_SEGMENTS_PER_QUARTER = 8
const MAX_SEGMENTS_PER_QUARTER = 512

function segmentsForRadius(radiusMm: number): number {
  if (radiusMm <= 0) return MIN_SEGMENTS_PER_QUARTER
  const ratio = MAX_SAGITTA_MM / radiusMm
  if (ratio >= 1) return MIN_SEGMENTS_PER_QUARTER
  const n = Math.PI / (2 * Math.acos(1 - ratio))
  return Math.max(
    MIN_SEGMENTS_PER_QUARTER,
    Math.min(MAX_SEGMENTS_PER_QUARTER, Math.ceil(n)),
  )
}

/**
 * Tessellate a quarter-circle arc into intermediate float points (subgrid space).
 * Returns intermediate vertices only — excludes both `a` and `b`.
 *
 * `sweepCW`: true = clockwise in screen/subgrid Y-down space.
 * Points are in real subgrid coordinates (not x2 integers); callers convert to mm.
 */
function tessellateArc(
  a: Pt,
  b: Pt,
  center: Pt,
  sweepCW: boolean,
  radiusMm: number,
): Array<{ x: number; y: number }> {
  const n = segmentsForRadius(radiusMm)

  // Work in real subgrid coordinates (halve the x2/y2 integers).
  const ax = a.x2 / 2,
    ay = a.y2 / 2
  const bx = b.x2 / 2,
    by = b.y2 / 2
  const cx = center.x2 / 2,
    cy = center.y2 / 2

  const startAngle = Math.atan2(ay - cy, ax - cx)
  const endAngle = Math.atan2(by - cy, bx - cx)

  // Normalise delta to (-π, π], then enforce the requested sweep direction.
  // CW in Y-down (screen) space = decreasing angle = negative delta.
  let delta = endAngle - startAngle
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta <= -Math.PI) delta += 2 * Math.PI
  if (sweepCW && delta > 0) delta -= 2 * Math.PI
  if (!sweepCW && delta < 0) delta += 2 * Math.PI

  // Derive radius from the actual start point (all arcs are 0.5 subgrid units).
  const r = Math.hypot(ax - cx, ay - cy)

  const pts: Array<{ x: number; y: number }> = []
  for (let i = 1; i < n; i++) {
    const angle = startAngle + (delta * i) / n
    pts.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    })
  }
  return pts
}

// ---------------------------------------------------------------------------
// Coordinate conversion helpers shared by both emitters
// ---------------------------------------------------------------------------

function fmtMm(v: number): string {
  return (Math.round(v * 10000) / 10000).toString()
}

function toMmX(x2: number, originX2: number, mmPerUnit: number): number {
  return ((x2 - originX2) / 2) * mmPerUnit
}

/**
 * Convert a y2 (2× subgrid) coordinate to mm.
 * DXF uses a Y-up (mathematical) coordinate system, but subgrid coordinates
 * are Y-down (screen space). We flip Y here so the DXF geometry is not
 * mirrored: the output Y = bboxHeightMm - (y2 - originY2)/2 * mmPerUnit,
 * which maps originY2 → bboxHeightMm and maxY2 → 0.
 */
function toMmY(
  y2: number,
  originY2: number,
  mmPerUnit: number,
  bboxHeightMm: number,
): number {
  return bboxHeightMm - ((y2 - originY2) / 2) * mmPerUnit
}

// ---------------------------------------------------------------------------
// LWPOLYLINE generation (AC1015 mode)
//
// LWPOLYLINE bulge encoding:
//   bulge = tan(θ/4)  where θ is the central angle of the arc.
//   For quarter-circles: θ = π/2, so bulge = tan(π/8) ≈ 0.41421356.
//   Sign convention (DXF uses y-down screen space, same as subgrid):
//     positive bulge → CCW arc in that space (= SVG sweep 0)
//     negative bulge → CW arc  in that space (= SVG sweep 1)
// ---------------------------------------------------------------------------

const QUARTER_CIRCLE_BULGE = Math.tan(Math.PI / 8) // ≈ 0.41421356

/**
 * Emit one closed LWPOLYLINE from an ordered Edge[] loop.
 */
function edgeLoopToLwpolyline(
  path: Edge[],
  mmPerUnit: number,
  layerName: string,
  originX2: number,
  originY2: number,
  bboxHeightMm: number,
): string {
  if (path.length === 0) return ""

  const lines: string[] = []

  // Vertex count includes the explicit closing vertex (first point repeated).
  const vertexCount = path.length + 1

  lines.push("0\nLWPOLYLINE")
  lines.push("8\n" + layerName)
  // 70: flag bit 1 = closed
  lines.push("70\n1")
  // 90: vertex count (path vertices + explicit closing vertex)
  lines.push("90\n" + vertexCount)

  for (const edge of path) {
    const x = toMmX(edge.a.x2, originX2, mmPerUnit)
    const y = toMmY(edge.a.y2, originY2, mmPerUnit, bboxHeightMm)
    lines.push("10\n" + fmtMm(x))
    lines.push("20\n" + fmtMm(y))

    if (edge.kind === "arc") {
      // Coordinates are output in DXF Y-up space (toMmY flips Y).
      // A CW arc in screen Y-down space becomes CCW in DXF Y-up space.
      // DXF bulge sign convention (Y-up):
      //   positive bulge → CCW arc → SVG sweep=1 (CW in Y-down)
      //   negative bulge → CW arc  → SVG sweep=0 (CCW in Y-down)
      const bulge =
        edge.sweep === 1 ? QUARTER_CIRCLE_BULGE : -QUARTER_CIRCLE_BULGE
      lines.push("42\n" + fmtMm(bulge))
    } else {
      lines.push("42\n0")
    }
  }

  // Explicit closing vertex: repeat the first point so non-compliant viewers
  // that ignore the closed flag (70=1) still draw the final segment.
  const firstEdge = path[0]
  lines.push("10\n" + fmtMm(toMmX(firstEdge.a.x2, originX2, mmPerUnit)))
  lines.push(
    "20\n" + fmtMm(toMmY(firstEdge.a.y2, originY2, mmPerUnit, bboxHeightMm)),
  )
  lines.push("42\n0")

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// POLYLINE / VERTEX / SEQEND generation (AC1009 legacy mode)
// ---------------------------------------------------------------------------

/**
 * Flatten an Edge[] loop into a list of (x, y) mm coordinates by tessellating
 * all arc edges into straight-line segments.
 */
function flattenPathToPoints(
  path: Edge[],
  mmPerUnit: number,
  originX2: number,
  originY2: number,
  bboxHeightMm: number,
): Array<{ x: number; y: number }> {
  // Quarter-circle radius in mm: the quadrant half-size is 0.5 subgrid units.
  const radiusMm = 0.5 * mmPerUnit

  const pts: Array<{ x: number; y: number }> = []

  // Convert a Pt (x2/y2 integers) to mm output space.
  const ptToMm = (p: Pt) => ({
    x: toMmX(p.x2, originX2, mmPerUnit),
    y: toMmY(p.y2, originY2, mmPerUnit, bboxHeightMm),
  })

  // Convert a float subgrid {x, y} to mm output space.
  const sgToMm = (p: { x: number; y: number }) => ({
    x: (p.x - originX2 / 2) * mmPerUnit,
    y: bboxHeightMm - (p.y - originY2 / 2) * mmPerUnit,
  })

  for (const edge of path) {
    // Emit the start vertex of this edge.
    // For a closed polyline, each edge's .b == the next edge's .a, so we
    // never emit .b — the closed-flag handles the last→first link.
    pts.push(ptToMm(edge.a))

    if (edge.kind === "arc") {
      // For arcs, the stored center is the outer corner (opposite
      // side of the chord from the true circle center).  Reflect it across
      // the chord midpoint to get the actual center of curvature.
      const arcCenter = {
        x2: edge.a.x2 + edge.b.x2 - edge.center.x2,
        y2: edge.a.y2 + edge.b.y2 - edge.center.y2,
      }
      const sweepCW = edge.sweep === 0

      const interp = tessellateArc(edge.a, edge.b, arcCenter, sweepCW, radiusMm)
      for (const p of interp) {
        pts.push(sgToMm(p))
      }
    }
  }

  return pts
}

/**
 * Emit one closed POLYLINE entity (AC1009 style) from an ordered Edge[] loop.
 * All arcs are tessellated into straight-line vertices (bulge = 0).
 */
function edgeLoopToLegacyPolyline(
  path: Edge[],
  mmPerUnit: number,
  layerName: string,
  originX2: number,
  originY2: number,
  bboxHeightMm: number,
): string {
  if (path.length === 0) return ""

  const pts = flattenPathToPoints(
    path,
    mmPerUnit,
    originX2,
    originY2,
    bboxHeightMm,
  )
  if (pts.length === 0) return ""

  const lines: string[] = []

  // POLYLINE header
  lines.push("0\nPOLYLINE")
  lines.push("8\n" + layerName)
  lines.push("66\n1") // vertices-follow flag
  lines.push("70\n1") // closed polyline
  // Dummy elevation vertex (required by AC1009)
  lines.push("10\n0")
  lines.push("20\n0")
  lines.push("30\n0")

  // VERTEX records
  for (const p of pts) {
    lines.push("0\nVERTEX")
    lines.push("8\n" + layerName)
    lines.push("10\n" + fmtMm(p.x))
    lines.push("20\n" + fmtMm(p.y))
    lines.push("30\n0")
    lines.push("42\n0") // bulge = 0 (straight segment)
  }

  // Explicit closing vertex: repeat the first point so non-compliant viewers
  // that ignore the closed flag (70=1) still draw the final segment.
  lines.push("0\nVERTEX")
  lines.push("8\n" + layerName)
  lines.push("10\n" + fmtMm(pts[0].x))
  lines.push("20\n" + fmtMm(pts[0].y))
  lines.push("30\n0")
  lines.push("42\n0")

  lines.push("0\nSEQEND")
  lines.push("8\n" + layerName)

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Cutout circle generation
// ---------------------------------------------------------------------------

/**
 * Emit closed LWPOLYLINE circles for cutout holes (AC1015 mode).
 * A full circle is two half-arc segments, each with bulge = 1 (semicircle,
 * tan(π/4) = 1). CW orientation in screen space (y-down) → CCW after y-flip
 * → positive bulge for both halves.
 */
function generateCutoutLwpolylines(
  pointModifications: Map<string, PointModifications> | undefined,
  mmPerUnit: number,
  originX2: number,
  originY2: number,
  bboxHeightMm: number,
): string[] {
  if (!pointModifications) return []

  const results: string[] = []

  for (const [pointKey, mods] of pointModifications) {
    if (!mods.cutouts || mods.cutouts.length === 0) continue

    const [px, py] = pointKey.split(",").map(Number)

    for (const cutout of mods.cutouts) {
      const anchorOffset =
        cutout.anchor === "custom"
          ? (cutout.customOffset ?? { x: 0, y: 0 })
          : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
      // Translate same as polyline vertices: subtract origin, flip Y, convert to mm
      const cx =
        (px + anchorOffset.x + (cutout.offset?.x ?? 0) - originX2 / 2) *
        mmPerUnit
      const cy =
        bboxHeightMm -
        (py + anchorOffset.y + (cutout.offset?.y ?? 0) - originY2 / 2) *
          mmPerUnit
      const r = cutout.diameterMm / 2

      // Two-vertex closed LWPOLYLINE circle using bulge=1 (semicircle).
      // Coordinates are in DXF Y-up space. CW hole winding in Y-up DXF space
      // uses negative bulge (CW semicircle).
      const lines: string[] = []
      lines.push("0\nLWPOLYLINE")
      lines.push("8\nCUTOUTS")
      lines.push("70\n1") // closed
      lines.push("90\n2") // 2 vertices
      // vertex 1: right side (cx+r, cy)
      lines.push("10\n" + fmtMm(cx + r))
      lines.push("20\n" + fmtMm(cy))
      lines.push("42\n-1") // bulge=-1: CW semicircle (hole winding in Y-up)
      // vertex 2: left side (cx-r, cy)
      lines.push("10\n" + fmtMm(cx - r))
      lines.push("20\n" + fmtMm(cy))
      lines.push("42\n-1") // bulge=-1: CW semicircle (hole winding in Y-up)

      results.push(lines.join("\n"))
    }
  }

  return results
}

/**
 * Emit tessellated POLYLINE circles for cutout holes (AC1009 legacy mode).
 * Segment count is scale-aware via segmentsForRadius().
 */
function generateCutoutLegacyPolylines(
  pointModifications: Map<string, PointModifications> | undefined,
  mmPerUnit: number,
  originX2: number,
  originY2: number,
  bboxHeightMm: number,
): string[] {
  if (!pointModifications) return []

  const results: string[] = []

  for (const [pointKey, mods] of pointModifications) {
    if (!mods.cutouts || mods.cutouts.length === 0) continue

    const [px, py] = pointKey.split(",").map(Number)

    for (const cutout of mods.cutouts) {
      const anchorOffset =
        cutout.anchor === "custom"
          ? (cutout.customOffset ?? { x: 0, y: 0 })
          : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
      const cx =
        (px + anchorOffset.x + (cutout.offset?.x ?? 0) - originX2 / 2) *
        mmPerUnit
      // Flip Y: DXF uses Y-up coordinate system
      const cy =
        bboxHeightMm -
        (py + anchorOffset.y + (cutout.offset?.y ?? 0) - originY2 / 2) *
          mmPerUnit
      const r = cutout.diameterMm / 2

      // Full circle: 4 quarter-circles, each tessellated.
      // CW hole winding in DXF Y-up space → angle decreases (negative step).
      const quarterSegs = segmentsForRadius(r)
      const totalSegs = quarterSegs * 4

      const lines: string[] = []
      lines.push("0\nPOLYLINE")
      lines.push("8\nCUTOUTS")
      lines.push("66\n1") // vertices-follow
      lines.push("70\n1") // closed
      lines.push("10\n0")
      lines.push("20\n0")
      lines.push("30\n0")

      for (let i = 0; i < totalSegs; i++) {
        // CW winding (hole) in DXF Y-up space → angle decreases
        const angle = -(2 * Math.PI * i) / totalSegs
        lines.push("0\nVERTEX")
        lines.push("8\nCUTOUTS")
        lines.push("10\n" + fmtMm(cx + r * Math.cos(angle)))
        lines.push("20\n" + fmtMm(cy + r * Math.sin(angle)))
        lines.push("30\n0")
        lines.push("42\n0")
      }

      lines.push("0\nSEQEND")
      lines.push("8\nCUTOUTS")

      results.push(lines.join("\n"))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// DXF document structure
// ---------------------------------------------------------------------------

interface BoundingBoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function buildDxfHeader(
  layerNames: string[],
  bbox: BoundingBoxMm,
  legacy: boolean,
): string {
  const acadver = legacy ? "AC1009" : "AC1015"

  const layerDefs = layerNames
    .map((name) => `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS`)
    .join("\n")

  // Pad bounding box slightly so viewers don't clip at the exact edge
  const pad = 1 // 1 mm margin
  const x0 = fmtMm(bbox.minX - pad)
  const y0 = fmtMm(bbox.minY - pad)
  const x1 = fmtMm(bbox.maxX + pad)
  const y1 = fmtMm(bbox.maxY + pad)

  return `0
SECTION
2
HEADER
9
$ACADVER
1
${acadver}
9
$INSUNITS
70
4
9
$MEASUREMENT
70
1
9
$EXTMIN
10
${x0}
20
${y0}
30
0
9
$EXTMAX
10
${x1}
20
${y1}
30
0
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
${layerNames.length}
${layerDefs}
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES`
}

function buildDxfFooter(): string {
  return `0
ENDSEC
0
EOF`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete DXF document string for a single layer.
 *
 * @param geometry   BlobGeometry from BlobEngine
 * @param layer      GridLayer (for cutout pointModifications)
 * @param mmPerUnit  Millimetres per subgrid unit
 * @param layerName  DXF layer name (e.g. "layer-1")
 */
export function generateLayerDxf(
  geometry: BlobGeometry,
  layer: GridLayer | undefined,
  mmPerUnit: number,
  layerName: string = "0",
): string {
  if (geometry.primitives.length === 0) return ""

  // Step 1: collect edges
  const allEdges: Edge[] = []
  for (const primitive of geometry.primitives) {
    allEdges.push(...primitiveToEdges(primitive))
  }

  // Step 2: deduplicate
  const boundaryEdges = deduplicateEdges(allEdges)

  // Step 3: stitch into closed loops
  const paths = stitchEdgesIntoPaths(boundaryEdges)

  // Compute bounding box origin from geometry (in 2× subgrid integers)
  // so we can translate all coordinates to start at (0, 0).
  const originX2 = Math.round(geometry.boundingBox.min.x * 2)
  const originY2 = Math.round(geometry.boundingBox.min.y * 2)

  // Physical bounding box in mm (after origin translation → starts at 0,0)
  const bboxWidthMm =
    (geometry.boundingBox.max.x - geometry.boundingBox.min.x) * mmPerUnit
  const bboxHeightMm =
    (geometry.boundingBox.max.y - geometry.boundingBox.min.y) * mmPerUnit
  const bbox: BoundingBoxMm = {
    minX: 0,
    minY: 0,
    maxX: bboxWidthMm,
    maxY: bboxHeightMm,
  }

  // Step 4: emit polyline entities
  let polylines: string[]
  let cutoutPolylines: string[]

  if (USE_LEGACY_POLYLINE) {
    // AC1009: tessellated POLYLINE/VERTEX/SEQEND, no bulge
    polylines = paths.map((path) =>
      edgeLoopToLegacyPolyline(
        path,
        mmPerUnit,
        layerName,
        originX2,
        originY2,
        bboxHeightMm,
      ),
    )
    cutoutPolylines = layer
      ? generateCutoutLegacyPolylines(
          layer.pointModifications,
          mmPerUnit,
          originX2,
          originY2,
          bboxHeightMm,
        )
      : []
  } else {
    // AC1015: LWPOLYLINE with bulge-encoded arcs
    polylines = paths.map((path) =>
      edgeLoopToLwpolyline(
        path,
        mmPerUnit,
        layerName,
        originX2,
        originY2,
        bboxHeightMm,
      ),
    )
    cutoutPolylines = layer
      ? generateCutoutLwpolylines(
          layer.pointModifications,
          mmPerUnit,
          originX2,
          originY2,
          bboxHeightMm,
        )
      : []
  }

  const usedLayerNames = [layerName]
  if (cutoutPolylines.length > 0) usedLayerNames.push("CUTOUTS")

  const entities = [...polylines, ...cutoutPolylines].filter(Boolean).join("\n")

  return [
    buildDxfHeader(usedLayerNames, bbox, USE_LEGACY_POLYLINE),
    entities,
    buildDxfFooter(),
  ].join("\n")
}
