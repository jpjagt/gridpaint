/**
 * Tests for primitivePaths — the world-space path emission used by the
 * Canvas2DRenderer's single-fill-per-layer rendering.
 *
 * Invariants under test:
 *  1. Uniform winding: every emitted subpath has positive shoelache area in
 *     y-down coordinates (screen clockwise). Required because all primitives
 *     of a layer are filled as ONE nonzero-winding path — a single
 *     opposite-wound subpath would punch a hole where shapes overlap
 *     (e.g. merged half-offset groups).
 *  2. Exact tangency: curve endpoints sit exactly on the quadrant boundary
 *     midlines, with axis-aligned tangents, so curves continue straight edges
 *     with no corner point (no feather expansion distorting the arc).
 *  3. Exact adjacency: neighboring primitives share identical edge
 *     coordinates — no gaps, no overlap (seam-freedom comes from single-fill,
 *     not from expansion hacks).
 *  4. Placement: quadrant rotation maps shapes into the correct quarter of
 *     the correct cell, for plain and renderQuadrant-overridden primitives.
 */

import { describe, it, expect } from "vitest"
import type { BlobPrimitive, Quadrant } from "@/lib/blob-engine/types"
import { appendPrimitivePath } from "@/lib/blob-engine/renderers/primitivePaths"
import type { PathSink } from "@/lib/blob-engine/types"

const GRID_SIZE = 50
const S = GRID_SIZE / 2

// ---------------------------------------------------------------------------
// Recording sink
// ---------------------------------------------------------------------------

type Pt = [number, number]

interface Subpath {
  /** Raw command anchor points in order (no bezier sampling) */
  anchors: Pt[]
  /** Polygonized outline (beziers sampled) for area computation */
  polygon: Pt[]
  /** Bezier segments as [start, c1, c2, end] */
  beziers: Array<[Pt, Pt, Pt, Pt]>
  closed: boolean
}

function sampleCubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 16): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    const x =
      mt * mt * mt * p0[0] +
      3 * mt * mt * t * c1[0] +
      3 * mt * t * t * c2[0] +
      t * t * t * p1[0]
    const y =
      mt * mt * mt * p0[1] +
      3 * mt * mt * t * c1[1] +
      3 * mt * t * t * c2[1] +
      t * t * t * p1[1]
    out.push([x, y])
  }
  return out
}

class RecordingSink implements PathSink {
  subpaths: Subpath[] = []
  private current: Subpath | null = null

  moveTo(x: number, y: number): void {
    this.current = { anchors: [[x, y]], polygon: [[x, y]], beziers: [], closed: false }
    this.subpaths.push(this.current)
  }

  lineTo(x: number, y: number): void {
    this.current!.anchors.push([x, y])
    this.current!.polygon.push([x, y])
  }

  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void {
    const cur = this.current!
    const start = cur.polygon[cur.polygon.length - 1]
    cur.beziers.push([start, [c1x, c1y], [c2x, c2y], [x, y]])
    cur.polygon.push(...sampleCubic(start, [c1x, c1y], [c2x, c2y], [x, y]))
    cur.anchors.push([x, y])
  }

  closePath(): void {
    this.current!.closed = true
  }
}

/** Shoelace sum in raw y-down coords; positive = clockwise on screen. */
function signedArea(polygon: Pt[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

function emit(primitive: BlobPrimitive): RecordingSink {
  const sink = new RecordingSink()
  appendPrimitivePath(sink, primitive, GRID_SIZE)
  return sink
}

function makePrimitive(
  type: BlobPrimitive["type"],
  quadrant: Quadrant,
  renderQuadrant?: Quadrant,
  center = { x: 0, y: 0 },
): BlobPrimitive {
  return {
    type,
    center,
    quadrant,
    size: S,
    layerId: 1,
    curveType: "none",
    ...(renderQuadrant !== undefined ? { renderQuadrant } : {}),
  }
}

function bbox(polygon: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** Expected world bounds of a quadrant of cell (0,0): SE/SW/NW/NE */
function quadrantBounds(quadrant: Quadrant) {
  const cx = GRID_SIZE / 2
  const cy = GRID_SIZE / 2
  switch (quadrant) {
    case 0: return { minX: cx, minY: cy, maxX: cx + S, maxY: cy + S } // SE
    case 1: return { minX: cx - S, minY: cy, maxX: cx, maxY: cy + S } // SW
    case 2: return { minX: cx - S, minY: cy - S, maxX: cx, maxY: cy } // NW
    case 3: return { minX: cx, minY: cy - S, maxX: cx + S, maxY: cy } // NE
  }
}

const QUADRANTS: Quadrant[] = [0, 1, 2, 3]
const CURVED_TYPES = ["roundedCorner", "diagonalBridge"] as const

// ---------------------------------------------------------------------------
// 1. Uniform winding
// ---------------------------------------------------------------------------

describe("uniform winding", () => {
  it("rectangles wind clockwise (positive area) in every quadrant", () => {
    for (const q of QUADRANTS) {
      const sink = emit(makePrimitive("rectangle", q))
      expect(sink.subpaths).toHaveLength(1)
      expect(signedArea(sink.subpaths[0].polygon)).toBeGreaterThan(0)
    }
  })

  it("curved primitives wind clockwise for every quadrant × renderQuadrant", () => {
    for (const type of CURVED_TYPES) {
      for (const q of QUADRANTS) {
        for (const rq of QUADRANTS) {
          const sink = emit(makePrimitive(type, q, rq))
          expect(sink.subpaths).toHaveLength(1)
          const area = signedArea(sink.subpaths[0].polygon)
          expect(area, `${type} q=${q} rq=${rq}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it("every subpath is closed", () => {
    for (const type of ["rectangle", ...CURVED_TYPES] as const) {
      for (const q of QUADRANTS) {
        const sink = emit(makePrimitive(type, q))
        expect(sink.subpaths[0].closed).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Exact tangency (no feather)
// ---------------------------------------------------------------------------

describe("curve tangency", () => {
  it("roundedCorner curve endpoints lie on cell-edge midpoints with axis-aligned tangents", () => {
    // SE quadrant of cell (0,0): quadrant spans (25,25)-(50,50).
    // The quarter circle replaces the (50,50) corner: it must run from
    // exactly (50,25) to exactly (25,50).
    const sink = emit(makePrimitive("roundedCorner", 0))
    const [bez] = sink.subpaths[0].beziers
    expect(bez).toBeDefined()
    const [start, c1, c2, end] = bez

    const endpoints = [start, end].map(([x, y]) => `${x},${y}`).sort()
    expect(endpoints).toEqual(["25,50", "50,25"])

    // Tangents at both ends must be exactly axis-aligned (continuing the
    // straight quadrant edges with no corner point)
    const t0 = [c1[0] - start[0], c1[1] - start[1]]
    const t1 = [end[0] - c2[0], end[1] - c2[1]]
    expect(t0[0] === 0 || t0[1] === 0).toBe(true)
    expect(t1[0] === 0 || t1[1] === 0).toBe(true)
    // And not degenerate
    expect(Math.hypot(t0[0], t0[1])).toBeGreaterThan(0)
    expect(Math.hypot(t1[0], t1[1])).toBeGreaterThan(0)
  })

  it("curve endpoints have axis-aligned tangents for all quadrant/renderQuadrant combos", () => {
    for (const type of CURVED_TYPES) {
      for (const q of QUADRANTS) {
        for (const rq of QUADRANTS) {
          const sink = emit(makePrimitive(type, q, rq))
          for (const [start, c1, c2, end] of sink.subpaths[0].beziers) {
            const t0 = [c1[0] - start[0], c1[1] - start[1]]
            const t1 = [end[0] - c2[0], end[1] - c2[1]]
            expect(t0[0] === 0 || t0[1] === 0, `${type} q=${q} rq=${rq} start tangent`).toBe(true)
            expect(t1[0] === 0 || t1[1] === 0, `${type} q=${q} rq=${rq} end tangent`).toBe(true)
          }
        }
      }
    }
  })

  it("roundedCorner and diagonalBridge with same orientation share the identical curve", () => {
    // The bridge fills the area on the other side of the same quarter circle;
    // their curve geometry (as unordered point sets) must coincide exactly.
    for (const q of QUADRANTS) {
      const corner = emit(makePrimitive("roundedCorner", q)).subpaths[0].beziers[0]
      const bridge = emit(makePrimitive("diagonalBridge", q)).subpaths[0].beziers[0]
      const key = (b: [Pt, Pt, Pt, Pt]) =>
        b.map(([x, y]) => `${x},${y}`).sort().join("|")
      expect(key(bridge)).toEqual(key(corner))
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Exact adjacency — no feather gaps or overlaps
// ---------------------------------------------------------------------------

describe("exact adjacency", () => {
  it("rectangle exactly covers its quadrant (no expansion)", () => {
    for (const q of QUADRANTS) {
      const sink = emit(makePrimitive("rectangle", q))
      expect(bbox(sink.subpaths[0].polygon)).toEqual(quadrantBounds(q))
    }
  })

  it("adjacent quadrant rectangles share identical edge coordinates", () => {
    const se = bbox(emit(makePrimitive("rectangle", 0)).subpaths[0].polygon)
    const ne = bbox(emit(makePrimitive("rectangle", 3)).subpaths[0].polygon)
    const sw = bbox(emit(makePrimitive("rectangle", 1)).subpaths[0].polygon)
    // NE sits exactly on top of SE
    expect(ne.maxY).toBe(se.minY)
    expect(ne.minX).toBe(se.minX)
    expect(ne.maxX).toBe(se.maxX)
    // SW sits exactly left of SE
    expect(sw.maxX).toBe(se.minX)
    expect(sw.minY).toBe(se.minY)
    expect(sw.maxY).toBe(se.maxY)
  })

  it("curve endpoint coincides exactly with the neighboring rectangle corner", () => {
    // SE roundedCorner starts at (50,25); the NE rectangle above spans
    // (25,0)-(50,25) — its SE corner is exactly (50,25).
    const curve = emit(makePrimitive("roundedCorner", 0)).subpaths[0]
    const neRect = bbox(emit(makePrimitive("rectangle", 3)).subpaths[0].polygon)
    const curvePoints = curve.anchors.map(([x, y]) => `${x},${y}`)
    expect(curvePoints).toContain(`${neRect.maxX},${neRect.maxY}`)
  })
})

// ---------------------------------------------------------------------------
// 4. Placement
// ---------------------------------------------------------------------------

describe("placement", () => {
  it("all primitive types stay within their quadrant bounds", () => {
    for (const type of ["rectangle", ...CURVED_TYPES] as const) {
      for (const q of QUADRANTS) {
        for (const rq of QUADRANTS) {
          const sink = emit(makePrimitive(type, q, rq))
          const b = bbox(sink.subpaths[0].polygon)
          const expected = quadrantBounds(q)
          expect(b.minX, `${type} q=${q} rq=${rq}`).toBeGreaterThanOrEqual(expected.minX - 1e-9)
          expect(b.minY, `${type} q=${q} rq=${rq}`).toBeGreaterThanOrEqual(expected.minY - 1e-9)
          expect(b.maxX, `${type} q=${q} rq=${rq}`).toBeLessThanOrEqual(expected.maxX + 1e-9)
          expect(b.maxY, `${type} q=${q} rq=${rq}`).toBeLessThanOrEqual(expected.maxY + 1e-9)
        }
      }
    }
  })

  it("cell coordinates translate the path by whole grid cells", () => {
    const atOrigin = emit(makePrimitive("roundedCorner", 0))
    const moved = emit(makePrimitive("roundedCorner", 0, undefined, { x: 3, y: -2 }))
    const a = atOrigin.subpaths[0].polygon
    const m = moved.subpaths[0].polygon
    expect(m.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      expect(m[i][0]).toBeCloseTo(a[i][0] + 3 * GRID_SIZE, 9)
      expect(m[i][1]).toBeCloseTo(a[i][1] + -2 * GRID_SIZE, 9)
    }
  })

  it("renderQuadrant rotates the shape within the same physical quadrant", () => {
    // Same physical quadrant, different renderQuadrant ⇒ same bounds,
    // different geometry (for curved shapes).
    const plain = emit(makePrimitive("roundedCorner", 0, 0)).subpaths[0]
    const flipped = emit(makePrimitive("roundedCorner", 0, 2)).subpaths[0]
    expect(polyKey(plain.polygon)).not.toEqual(polyKey(flipped.polygon))
    // Curve of rq=2 bulges toward the inner corner (25,25) instead of (50,50):
    // its curve midpoint must be nearer to (25,25) than rq=0's midpoint is.
    const mid = (b: [Pt, Pt, Pt, Pt]) => sampleCubic(b[0], b[1], b[2], b[3], 2)[0]
    const dist = (p: Pt, q2: Pt) => Math.hypot(p[0] - q2[0], p[1] - q2[1])
    const plainMid = mid(plain.beziers[0])
    const flippedMid = mid(flipped.beziers[0])
    expect(dist(flippedMid, [25, 25])).toBeLessThan(dist(plainMid, [25, 25]))
  })
})

function polyKey(polygon: Pt[]): string {
  return polygon.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join("|")
}
