/**
 * SVG path containment utilities.
 *
 * Provides robust outer/hole detection for SVG paths using arc-aware
 * sampling (points-on-path) and polygon-based ray-cast containment.
 *
 * WHY NOT point-in-svg-path:
 * The `point-in-svg-path` library sub-divides Bézier curves using a step size
 * of `~~(arcLength / 8)` samples. Our blob paths use quarter-circle arcs with
 * radius 0.5 (arc length ≈ 0.785), so `~~(0.785 / 8) = 0` — the intersection
 * loop never executes and the function always returns `false`, regardless of
 * whether the point is inside or outside.
 *
 * FIX: use `points-on-path` (which works correctly at small scales) to
 * approximate the outer path as a dense polygon, then use a standard
 * even-odd ray-cast against that polygon. This is accurate enough for the
 * blob shapes this app produces and has no scale dependency.
 */

import { pointsOnPath } from "points-on-path"
import type { PathGroup } from "@/types/pathUtils"

export type { PathGroup }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of evenly-spaced points sampled from the *inner* path when testing
 * whether all of them lie inside the candidate outer path.
 */
const SAMPLE_COUNT = 50

/**
 * Tolerance passed to pointsOnPath for both inner sampling and outer polygon
 * approximation. Lower = denser and more accurate. 0.25 gives sub-pixel
 * accuracy on grid-unit scale paths.
 */
const CURVE_TOLERANCE = 0.25

// ---------------------------------------------------------------------------
// Polygon approximation
// ---------------------------------------------------------------------------

/**
 * Convert an SVG path string to a flat polygon by sampling it densely with
 * `points-on-path`. Returns all contour points concatenated.
 */
function pathToPolygon(d: string): Array<[number, number]> {
  const contours = pointsOnPath(d, CURVE_TOLERANCE) as Array<Array<[number, number]>>
  return contours.flat()
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

interface SampledPoint {
  x: number
  y: number
}

/**
 * Sample up to SAMPLE_COUNT evenly-spaced points along an SVG path.
 * pointsOnPath returns one contour array per M-subpath; we flatten them.
 */
function samplePoints(d: string): SampledPoint[] {
  const contours = pointsOnPath(d, CURVE_TOLERANCE) as Array<Array<[number, number]>>
  const all = contours.flat()
  if (all.length === 0) return []

  const count = Math.min(SAMPLE_COUNT, all.length)
  const step = all.length / count
  const result: SampledPoint[] = []
  for (let i = 0; i < count; i++) {
    const pt = all[Math.floor(i * step)]
    result.push({ x: pt[0], y: pt[1] })
  }
  return result
}

// ---------------------------------------------------------------------------
// Containment test
// ---------------------------------------------------------------------------

/**
 * Even-odd ray-cast point-in-polygon test.
 *
 * Casts a horizontal ray from (px, py) to +∞ and counts crossings with the
 * polygon edges. Odd count → inside.
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
 * Returns true if (nearly) all sampled points of `inner` lie inside the
 * polygon approximation of `outer`.
 *
 * Using a polygon approximation (via points-on-path) rather than the
 * point-in-svg-path library avoids a precision bug: that library uses a
 * step size of ~~(arcLength/8) which collapses to 0 for arcs shorter than
 * 8 units — all arcs in our coordinate space — making it always return false.
 *
 * We use a fraction-based tolerance rather than an absolute count. Up to
 * MAX_OUTSIDE_FRACTION of the sampled points may be classified as
 * outside/on-boundary. This handles two known degenerate cases:
 *
 *   1. "Pinch point" (single shared vertex): 1–2 sampled points land exactly
 *      on the outer polygon boundary, where the even-odd ray-cast is
 *      numerically degenerate.
 *
 *   2. "Shared edge": the inner loop shares a straight edge with the outer
 *      loop (e.g. flat-line group whose top edge coincides with the inner void
 *      boundary). Several sampled points lie exactly on the boundary.
 *
 * In both cases, the fraction of on-boundary/outside points is small (< 15%)
 * compared to the near-zero fraction for genuinely disjoint paths.
 */
const MAX_OUTSIDE_FRACTION = 0.2

function isFullyContained(inner: string, outer: string): boolean {
  const points = samplePoints(inner)
  if (points.length === 0) return false
  const outerPolygon = pathToPolygon(outer)
  if (outerPolygon.length === 0) return false

  let outsideCount = 0
  for (const p of points) {
    if (!isPointInPolygon(p.x, p.y, outerPolygon)) {
      outsideCount++
    }
  }
  return outsideCount / points.length <= MAX_OUTSIDE_FRACTION
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Group SVG paths into outer shapes and their holes.
 *
 * Algorithm:
 * 1. A path is an **outer** shape if it is not fully contained by any other path.
 * 2. The **holes** of an outer path are all paths that are fully contained by it.
 *
 * This correctly handles:
 * - Multiple disconnected outer shapes (two solid blobs → 2 groups, 0 holes each)
 * - Donut shapes (outer ring + inner hole → 1 group with 1 hole)
 * - Two donuts side by side → 2 groups each with 1 hole
 * - Paths with no holes → group with empty holes array
 */
export function createPathGroups(svgPaths: string[]): PathGroup[] {
  if (svgPaths.length === 0) return []
  if (svgPaths.length === 1) return [{ outer: svgPaths[0], holes: [] }]

  // Step 1: determine which paths are contained in some other path.
  const isHole = svgPaths.map((pathA, i) =>
    svgPaths.some((pathB, j) => i !== j && isFullyContained(pathA, pathB)),
  )

  // Step 2: for each outer path, collect everything contained inside it.
  const groups: PathGroup[] = []

  for (let i = 0; i < svgPaths.length; i++) {
    if (isHole[i]) continue // skip inner paths

    const holes: string[] = []
    for (let j = 0; j < svgPaths.length; j++) {
      if (i === j) continue
      if (isFullyContained(svgPaths[j], svgPaths[i])) {
        holes.push(svgPaths[j])
      }
    }

    groups.push({ outer: svgPaths[i], holes })
  }

  return groups
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
