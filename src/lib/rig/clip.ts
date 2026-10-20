/**
 * Thin wrapper over clipper-lib for float regions in mm. Clipper works on
 * integers, so coordinates are scaled to micrometres.
 */

import * as ClipperNS from "clipper-lib"
import type { Region, Ring, Vec2 } from "@/types/rig"

// clipper-lib is CommonJS (module.exports = ClipperLib); bundlers expose it
// either as the namespace itself or as its default export.
const CL = ((ClipperNS as unknown as { default?: typeof ClipperNS }).default ??
  ClipperNS) as typeof ClipperNS

const SCALE = 1000
const ARC_TOLERANCE = 0.01 * SCALE

function toPaths(region: Region): ClipperNS.Paths {
  return region.map((ring) =>
    ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
  )
}

/** Vertices closer than this are merged, removing jitter from booleans */
const CLEAN_DISTANCE = 0.005 * SCALE

function fromPaths(paths: ClipperNS.Paths): Region {
  return CL.Clipper.CleanPolygons(paths, CLEAN_DISTANCE)
    .filter((p) => p.length >= 3)
    .map((path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })))
}

function execute(
  type: ClipperNS.ClipType,
  subject: Region,
  clip: Region,
): Region {
  const c = new CL.Clipper()
  c.AddPaths(toPaths(subject), CL.PolyType.ptSubject, true)
  c.AddPaths(toPaths(clip), CL.PolyType.ptClip, true)
  const out: ClipperNS.Paths = []
  c.Execute(
    type,
    out,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  )
  return fromPaths(out)
}

export function union(...regions: Region[]): Region {
  const all = regions.flat()
  if (all.length === 0) return []
  return execute(CL.ClipType.ctUnion, all, [])
}

export function difference(a: Region, b: Region): Region {
  if (a.length === 0) return []
  if (b.length === 0) return a
  return execute(CL.ClipType.ctDifference, a, b)
}

export function intersection(a: Region, b: Region): Region {
  if (a.length === 0 || b.length === 0) return []
  return execute(CL.ClipType.ctIntersection, a, b)
}

/** Grow (delta > 0) or shrink (delta < 0) a region with round joins. */
export function offset(region: Region, delta: number): Region {
  if (region.length === 0) return []
  if (delta === 0) return union(region)
  const co = new CL.ClipperOffset(2, ARC_TOLERANCE)
  co.AddPaths(toPaths(region), CL.JoinType.jtRound, CL.EndType.etClosedPolygon)
  const out: ClipperNS.Paths = []
  co.Execute(out, delta * SCALE)
  return fromPaths(out)
}

/** Signed area of a ring (positive = clockwise in y-down, i.e. an outer). */
export function ringArea(ring: Ring): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Total area of a non-overlapping region (holes subtract). */
export function area(region: Region): number {
  return Math.abs(region.reduce((s, r) => s + ringArea(r), 0))
}

export function isEmpty(region: Region, minArea = 1e-4): boolean {
  return area(region) < minArea
}

/** Non-zero winding point test. */
export function contains(region: Region, p: Vec2): boolean {
  let winding = 0
  for (const ring of region) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a.y <= p.y) {
        if (b.y > p.y && cross(a, b, p) > 0) winding++
      } else if (b.y <= p.y && cross(a, b, p) < 0) {
        winding--
      }
    }
  }
  return winding !== 0
}

function cross(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

/** Distance from p to the nearest edge of the region. */
export function distanceToBoundary(region: Region, p: Vec2): number {
  let best = Infinity
  for (const ring of region) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t =
        len2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      const ex = a.x + t * dx - p.x
      const ey = a.y + t * dy - p.y
      best = Math.min(best, ex * ex + ey * ey)
    }
  }
  return Math.sqrt(best)
}

export function rect(x0: number, y0: number, x1: number, y1: number): Region {
  // Clockwise in y-down (positive area) = outer
  return [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  ]
}

export function circle(c: Vec2, r: number, segments = 24): Region {
  const ring: Ring = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    ring.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })
  }
  return [ring]
}

export function bounds(region: Region): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of region)
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  return { minX, minY, maxX, maxY }
}

export interface RegionPiece {
  outer: Ring
  holes: Ring[]
}

/**
 * Split a region into connected pieces (outer + holes), via a PolyTree.
 * Outers have positive ringArea, holes negative.
 */
export function pieces(region: Region): RegionPiece[] {
  if (region.length === 0) return []
  const c = new CL.Clipper()
  c.AddPaths(toPaths(region), CL.PolyType.ptSubject, true)
  const tree = new CL.PolyTree()
  c.Execute(
    CL.ClipType.ctUnion,
    tree,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  )
  const out: RegionPiece[] = []
  const visit = (node: ClipperNS.PolyNode) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) continue
      const outer = fromPaths([child.Contour()])[0]
      if (!outer) continue
      const holes = fromPaths(child.Childs().map((h) => h.Contour()))
      out.push({ outer, holes })
      for (const hole of child.Childs()) visit(hole)
    }
  }
  visit(tree)
  return out
}
