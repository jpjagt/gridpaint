/**
 * SVG path outer/hole grouping.
 *
 * Relies on the SvgPathRenderer ORIENTATION GUARANTEE (see its header):
 * loops emitted by the renderer have meaningful winding — outer boundaries
 * are clockwise in SVG y-down coords (positive shoelace area) and holes are
 * counter-clockwise (negative). Cutout circles are emitted CCW as well.
 *
 * Classification is therefore a pure sign check; ray-casting is only used to
 * ASSIGN each hole to its (smallest) containing outer. This replaced an
 * all-pairs "is fully contained" ray-cast classifier that needed an
 * outside-fraction fudge factor and still misclassified loops whenever a
 * sampled point landed on the 0.5 subgrid that all blob geometry lives on
 * (tangent points, shared edges, pinch vertices).
 */

import { pointsOnPath } from "points-on-path"
import type { PathGroup } from "@/types/pathUtils"

export type { PathGroup }

/**
 * Tolerance passed to pointsOnPath when flattening paths to polygons.
 * Lower = denser and more accurate. 0.25 gives sub-pixel accuracy on
 * grid-unit scale paths.
 */
const CURVE_TOLERANCE = 0.25

/**
 * Convert an SVG path string to a flat polygon by sampling it densely with
 * `points-on-path`. Returns all contour points concatenated.
 */
function pathToPolygon(d: string): Array<[number, number]> {
  const contours = pointsOnPath(d, CURVE_TOLERANCE) as Array<Array<[number, number]>>
  return contours.flat()
}

/** Shoelace signed area. Positive = clockwise in y-down SVG coords. */
function signedArea(polygon: Array<[number, number]>): number {
  let s = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/**
 * Even-odd ray-cast point-in-polygon test.
 */
function isPointInPolygon(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Majority-vote containment: individual sampled points can land exactly on
 * the outer polygon's boundary at pinch/tangency vertices (where a single
 * ray-cast is numerically degenerate), but never the majority of points.
 */
function polygonInsidePolygon(
  inner: Array<[number, number]>,
  outer: Array<[number, number]>,
): boolean {
  const step = Math.max(1, Math.floor(inner.length / 32))
  let inside = 0
  let total = 0
  for (let i = 0; i < inner.length; i += step) {
    total++
    if (isPointInPolygon(inner[i][0], inner[i][1], outer)) inside++
  }
  return inside * 2 > total
}

/**
 * Group SVG paths into outer shapes and their holes.
 *
 * 1. Classify each path by winding: positive shoelace area → outer,
 *    negative → hole (the SvgPathRenderer orientation guarantee).
 * 2. Assign each hole to the smallest-area outer that contains it, so
 *    islands nested inside another shape's hole keep their own holes.
 *
 * This correctly handles:
 * - Multiple disconnected outer shapes (two solid blobs → 2 groups, 0 holes each)
 * - Donut shapes (outer ring + inner hole → 1 group with 1 hole)
 * - Disconnected shapes that touch at a single subgrid point
 * - Islands inside another shape's hole (each solid keeps its own holes)
 */
export function createPathGroups(svgPaths: string[]): PathGroup[] {
  if (svgPaths.length === 0) return []
  if (svgPaths.length === 1) return [{ outer: svgPaths[0], holes: [] }]

  interface Loop {
    d: string
    polygon: Array<[number, number]>
    area: number
  }

  const outers: Loop[] = []
  const holes: Loop[] = []

  for (const d of svgPaths) {
    const polygon = pathToPolygon(d)
    if (polygon.length < 3) continue
    const area = signedArea(polygon)
    if (area >= 0) {
      outers.push({ d, polygon, area })
    } else {
      holes.push({ d, polygon, area })
    }
  }

  // Input order is preserved for the groups themselves; containment candidates
  // are checked smallest-first so holes attach to their innermost outer.
  const byAreaAsc = [...outers].sort((a, b) => a.area - b.area)
  const groups = new Map<Loop, PathGroup>(
    outers.map((o) => [o, { outer: o.d, holes: [] }]),
  )

  for (const hole of holes) {
    const target = byAreaAsc.find((o) => polygonInsidePolygon(hole.polygon, o.polygon))
    if (target) {
      groups.get(target)!.holes.push(hole.d)
    }
    // A hole contained in no outer is dropped: consumers either want outers
    // only (filterOuterPaths) or treat non-outer paths as holes anyway.
  }

  return [...groups.values()]
}

/**
 * Return only the outermost paths (discard inner holes).
 *
 * Thin wrapper around createPathGroups. Used by the holder generator to
 * strip inner hole paths before laser-cutting layout.
 */
export function filterOuterPaths(paths: string[]): string[] {
  if (paths.length <= 1) return paths
  return createPathGroups(paths).map((g) => g.outer)
}

/**
 * Extract all path `d` attribute strings from raw SVG content.
 */
export function extractPathsFromSvg(svgContent: string): string[] {
  const matches = svgContent.matchAll(/<path[^>]+d="([^"]+)"/g)
  return Array.from(matches).map((m) => m[1])
}
