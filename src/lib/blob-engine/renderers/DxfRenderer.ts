/**
 * DxfRenderer
 *
 * Produces a DXF R2000 file from BlobGeometry using the same edge-bag
 * algorithm as SvgPathRenderer:
 *
 *  1. Emit full perimeter edges (lines + quarter-circle arcs) per primitive.
 *  2. Deduplicate / cancel internal edges.
 *  3. Stitch surviving edges into closed loops.
 *  4. Emit one closed LWPOLYLINE per loop, encoding arcs via the DXF bulge
 *     value: bulge = tan(θ/4).  For quarter-circles θ=90° so bulge = tan(22.5°)
 *     ≈ 0.41421356.  Sign: positive = CCW, negative = CW (matching SVG
 *     sweep-flag=0 → CCW → positive bulge).
 *  5. Cutouts are emitted as separate closed LWPOLYLINE circles (two-arc
 *     half-circle technique) on a dedicated "CUTOUTS" layer.
 *
 * Coordinates are output in mm: subgrid_coord × mmPerUnit.
 * (Subgrid units are already half-gridcell units; the conversion factor covers
 *  the full chain: raw subgrid → physical mm.)
 */

import type { BlobGeometry, BlobPrimitive, GridLayer } from "../types"
import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"
import type { PointModifications } from "@/types/gridpaint"

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
  center: Pt
  /** SVG sweep-flag convention: 1=CW (screen y-down), 0=CCW */
  sweep: 0 | 1
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
// DXF LWPOLYLINE generation
//
// LWPOLYLINE bulge encoding:
//   bulge = tan(θ/4)  where θ is the central angle of the arc.
//   For quarter-circles: θ = π/2, so bulge = tan(π/8) ≈ 0.41421356.
//   Sign convention (DXF uses y-down screen space, same as subgrid):
//     positive bulge → CCW arc in that space (= SVG sweep 0)
//     negative bulge → CW arc  in that space (= SVG sweep 1)
//
// We do NOT flip y. DXF CAM software doesn't care about axis orientation —
// the shape is correct either way and flipping introduced sign bugs. We
// instead translate all coordinates so the bounding box starts at (0, 0).
// ---------------------------------------------------------------------------

const QUARTER_CIRCLE_BULGE = Math.tan(Math.PI / 8) // ≈ 0.41421356

function fmtMm(v: number): string {
  return (Math.round(v * 10000) / 10000).toString()
}

/**
 * Emit one closed LWPOLYLINE from an ordered Edge[] loop.
 * `originX2` / `originY2` are the bounding-box mins (in 2× subgrid integers)
 * used to translate coordinates to start at (0, 0).
 */
function edgeLoopToLwpolyline(
  path: Edge[],
  mmPerUnit: number,
  layerName: string,
  originX2: number,
  originY2: number,
): string {
  if (path.length === 0) return ""

  const lines: string[] = []

  lines.push("0\nLWPOLYLINE")
  lines.push("8\n" + layerName)
  // 70: flag bit 1 = closed
  lines.push("70\n1")
  // 90: vertex count
  lines.push("90\n" + path.length)

  for (const edge of path) {
    // Translate so bounding-box min → (0, 0), then convert to mm
    const x = ((edge.a.x2 - originX2) / 2) * mmPerUnit
    const y = ((edge.a.y2 - originY2) / 2) * mmPerUnit
    lines.push("10\n" + fmtMm(x))
    lines.push("20\n" + fmtMm(y))

    if (edge.kind === "arc") {
      // Subgrid is y-down (screen coords); DXF bulge sign uses y-up (math coords).
      // CCW/CW are visually flipped between the two, so the mapping is:
      //   SVG sweep=1 (CW y-down)  → CCW y-up → positive bulge
      //   SVG sweep=0 (CCW y-down) → CW y-up  → negative bulge
      const bulge = edge.sweep === 1 ? QUARTER_CIRCLE_BULGE : -QUARTER_CIRCLE_BULGE
      lines.push("42\n" + fmtMm(bulge))
    } else {
      lines.push("42\n0")
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Cutout circle generation
// ---------------------------------------------------------------------------

/**
 * Emit closed LWPOLYLINE circles for cutout holes.
 * A full circle is two half-arc segments, each with bulge = 1 (semicircle,
 * tan(π/4) = 1). CW orientation in screen space (y-down) → CCW after y-flip
 * → positive bulge for both halves.
 */
function generateCutoutLwpolylines(
  pointModifications: Map<string, PointModifications> | undefined,
  mmPerUnit: number,
  originX2: number,
  originY2: number,
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
      // Translate same as polyline vertices: subtract origin, convert to mm
      const cx = ((px + anchorOffset.x + (cutout.offset?.x ?? 0)) - originX2 / 2) * mmPerUnit
      const cy = ((py + anchorOffset.y + (cutout.offset?.y ?? 0)) - originY2 / 2) * mmPerUnit
      const r = cutout.diameterMm / 2

      // Two-vertex closed LWPOLYLINE circle using bulge=1 (semicircle)
      // Rightmost point → leftmost point → (closed back to right)
      // Both vertices get bulge=1 for CCW semicircles in DXF math space
      const lines: string[] = []
      lines.push("0\nLWPOLYLINE")
      lines.push("8\nCUTOUTS")
      lines.push("70\n1") // closed
      lines.push("90\n2") // 2 vertices
      // Full circle as two semicircles. In y-down screen space CW = "inward hole"
      // which maps to bulge=-1 (CW in y-up math convention = negative bulge).
      // vertex 1: right side (cx+r, cy)
      lines.push("10\n" + fmtMm(cx + r))
      lines.push("20\n" + fmtMm(cy))
      lines.push("42\n-1") // bulge=-1: CW semicircle (hole winding)
      // vertex 2: left side (cx-r, cy)
      lines.push("10\n" + fmtMm(cx - r))
      lines.push("20\n" + fmtMm(cy))
      lines.push("42\n-1") // bulge=-1: CW semicircle (hole winding)

      results.push(lines.join("\n"))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// DXF document structure
// ---------------------------------------------------------------------------

function buildDxfHeader(layerNames: string[]): string {
  const layerDefs = layerNames
    .map(
      (name) =>
        `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS`,
    )
    .join("\n")

  return `0
SECTION
2
HEADER
9
$ACADVER
1
AC1015
9
$INSUNITS
70
4
9
$MEASUREMENT
70
1
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
ENDTABLE
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

  // Step 4: emit LWPOLYLINE entities
  const polylines = paths.map((path) =>
    edgeLoopToLwpolyline(path, mmPerUnit, layerName, originX2, originY2),
  )

  // Step 5: cutout circles on their own layer
  const cutoutPolylines = layer
    ? generateCutoutLwpolylines(layer.pointModifications, mmPerUnit, originX2, originY2)
    : []

  const usedLayerNames = [layerName]
  if (cutoutPolylines.length > 0) usedLayerNames.push("CUTOUTS")

  const entities = [...polylines, ...cutoutPolylines]
    .filter(Boolean)
    .join("\n")

  return [buildDxfHeader(usedLayerNames), entities, buildDxfFooter()].join("\n")
}
