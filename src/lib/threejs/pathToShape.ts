/**
 * Convert SVG paths to Three.js ExtrudeGeometry.
 *
 * Loop classification relies on the SvgPathRenderer ORIENTATION GUARANTEE:
 * outer boundaries are emitted clockwise in SVG coords (positive shoelace
 * area) and holes counter-clockwise (negative). Cutout circles are emitted
 * CCW, so they classify as holes with no special-casing.
 *
 * This replaces two earlier heuristic classifiers that both failed on
 * grid-aligned geometry (every vertex lives on the 0.5 subgrid, so ray casts
 * routinely graze tangent points and collinear edges):
 *   1. ray-cast containment with an outside-fraction tolerance, and
 *   2. SVGLoader's scanline even-odd classification, which inverted fills
 *      when disconnected shapes touched at a point or nested inside another
 *      shape's hole.
 *
 * Pipeline:
 *   1. Flatten each SVG loop to a polygon (SVGLoader used purely as a parser).
 *   2. Classify by shoelace sign: positive → outer, negative → hole.
 *   3. Assign each hole to the smallest-area outer that contains it
 *      (majority vote over the hole's points, robust at pinch/tangency).
 *   4. Y-flip into Three.js space, extrude each outer with its holes, merge.
 */

import * as THREE from "three"
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { extractPathsFromSvg } from "@/lib/export/pathUtils"
import type { ClassifiedSvgShape } from "@/types/threejs"

export interface SvgToShapesOptions {
  offsetX?: number
  offsetY?: number
}

/** Points per curve segment when flattening loops (arcs are quarter circles). */
const CURVE_DIVISIONS = 16

function getSvgDimensions(svgContent: string): { width: number; height: number } {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/)
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/)
    if (parts.length === 4) {
      return { width: parseFloat(parts[2]), height: parseFloat(parts[3]) }
    }
  }
  const widthMatch = svgContent.match(/width="([^"]+)"/)
  const heightMatch = svgContent.match(/height="([^"]+)"/)
  return {
    width: widthMatch ? parseFloat(widthMatch[1]) : 100,
    height: heightMatch ? parseFloat(heightMatch[1]) : 100,
  }
}

/**
 * Flatten a single-subpath `d` string into polygon points (SVG coords).
 * Returns null if the path cannot be parsed.
 */
function dStringToPoints(d: string, loader: SVGLoader): THREE.Vector2[] | null {
  const miniSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`
  const data = loader.parse(miniSvg)
  if (data.paths.length === 0 || data.paths[0].subPaths.length === 0) return null
  const points = data.paths[0].subPaths[0].getPoints(CURVE_DIVISIONS)
  // Closed paths repeat the first point at the end; drop the duplicate so
  // downstream polygon code never sees zero-length segments.
  if (points.length > 1 && points[0].equals(points[points.length - 1])) {
    points.pop()
  }
  return points.length >= 3 ? points : null
}

/**
 * Remove vertices that lie exactly on the segment between their neighbours
 * (grid-aligned straight runs produce a vertex every 0.5 units).
 *
 * This must happen BEFORE extrusion: earcut silently drops collinear
 * vertices while triangulating complex cap polygons, but the extruded side
 * walls would keep them — leaving hairline T-vertex cracks where cap edges
 * skip vertices that wall edges contain. Feeding earcut a polygon with no
 * collinear vertices keeps caps and walls combinatorially identical (and
 * shrinks the output mesh).
 */
function simplifyCollinear(points: THREE.Vector2[]): THREE.Vector2[] | null {
  if (points.length < 3) return null
  const result: THREE.Vector2[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]
    const p = points[i]
    const next = points[(i + 1) % points.length]
    const cross =
      (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x)
    if (Math.abs(cross) > 1e-12) result.push(p)
  }
  return result.length >= 3 ? result : null
}

/** Shoelace signed area. Positive = clockwise in y-down SVG coords. */
function signedArea(points: THREE.Vector2[]): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    s += p.x * q.y - q.x * p.y
  }
  return s / 2
}

/** Even-odd ray-cast point-in-polygon test. */
function pointInPolygon(px: number, py: number, polygon: THREE.Vector2[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Majority-vote containment: is `inner` inside `outer`?
 *
 * Individual points can land exactly on `outer`'s boundary at pinch/tangency
 * points (everything lives on the 0.5 subgrid), where a single ray-cast is
 * numerically degenerate — but never for the majority of points at once.
 */
function polygonInsidePolygon(inner: THREE.Vector2[], outer: THREE.Vector2[]): boolean {
  const step = Math.max(1, Math.floor(inner.length / 32))
  let inside = 0
  let total = 0
  for (let i = 0; i < inner.length; i += step) {
    total++
    if (pointInPolygon(inner[i].x, inner[i].y, outer)) inside++
  }
  return inside * 2 > total
}

/**
 * Pinch-point separation distance, in SVG units (grid units; microns once
 * scaled to mm). See resolvePinchPoints.
 */
const PINCH_EPSILON = 1e-3

/**
 * Nudge ring vertices that exactly coincide with a vertex of a DIFFERENT
 * ring of the same shape (a "pinch point": a hole meeting the contour, two
 * holes meeting at a corner, or a contour corner touching a hole's edge).
 *
 * Earcut bridges holes into the outer contour and silently drops duplicate
 * coincident vertices, which makes the cap triangulation skip pinch vertices
 * that the extruded side walls still contain — leaving hairline T-vertex
 * cracks in the mesh. Moving each pinching corner ~1µm towards its own
 * polygon neighbours (i.e. into its own region) separates the rings without
 * visibly changing geometry.
 *
 * Vertices in the middle of a straight run (neighbour midpoint == vertex)
 * are left alone: they are not corners, will be removed by collinear
 * simplification, and the opposing corner's nudge already breaks the pinch.
 */
function resolvePinchPoints(shape: ClassifiedSvgShape): void {
  const key = (p: THREE.Vector2) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`
  const rings = [shape.contour, ...shape.holes]

  // Map each vertex position to the indices of rings containing it.
  const occupancy = new Map<string, Set<number>>()
  for (let r = 0; r < rings.length; r++) {
    for (const p of rings[r]) {
      const k = key(p)
      let set = occupancy.get(k)
      if (!set) {
        set = new Set()
        occupancy.set(k, set)
      }
      set.add(r)
    }
  }

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const sharers = occupancy.get(key(p))!
      if (sharers.size < 2) continue // only this ring — not a pinch

      const prev = ring[(i - 1 + ring.length) % ring.length]
      const next = ring[(i + 1) % ring.length]
      const dx = (prev.x + next.x) / 2 - p.x
      const dy = (prev.y + next.y) / 2 - p.y
      const len = Math.hypot(dx, dy)
      if (len === 0) continue // mid-run vertex, not a corner
      ring[i] = new THREE.Vector2(
        p.x + (dx / len) * PINCH_EPSILON,
        p.y + (dy / len) * PINCH_EPSILON,
      )
    }
  }
}

/**
 * Extract and classify a layer SVG's loops into solid shapes with holes,
 * in SVG coordinates. Exported separately so tests can assert the topology
 * (shape/hole counts and areas) without decoding raw geometry buffers.
 *
 * Returns null when the SVG contains no usable loops.
 */
export function classifySvgLoops(svgContent: string): ClassifiedSvgShape[] | null {
  const ds = extractPathsFromSvg(svgContent)
  if (ds.length === 0) return null

  const loader = new SVGLoader()

  interface Loop {
    points: THREE.Vector2[]
    area: number // signed
  }
  const outers: Loop[] = []
  const holes: Loop[] = []

  for (const d of ds) {
    const points = dStringToPoints(d, loader)
    if (!points) continue
    const area = signedArea(points)
    if (area > 0) {
      outers.push({ points, area })
    } else if (area < 0) {
      holes.push({ points, area })
    }
    // area === 0: degenerate sliver, skip
  }

  if (outers.length === 0) return null

  // Smallest-first so each hole attaches to its innermost containing outer
  // (correct for islands nested inside other shapes' holes).
  outers.sort((a, b) => a.area - b.area)

  const shapes: ClassifiedSvgShape[] = outers.map((o) => ({
    contour: o.points,
    holes: [],
    area: o.area,
  }))

  for (const hole of holes) {
    const target = shapes.find((s) => polygonInsidePolygon(hole.points, s.contour))
    if (target) {
      target.holes.push(hole.points)
    } else if (import.meta.env?.DEV) {
      console.warn("[pathToShape] hole loop not contained in any outer; skipped")
    }
  }

  // Order matters: pinch resolution relies on coincident vertices still being
  // exact vertex-vertex matches on the 0.5 subgrid; collinear simplification
  // would remove a straight-run vertex that a hole pinches against, turning
  // the coincidence into an (undetectable) vertex-on-edge contact.
  for (const shape of shapes) {
    resolvePinchPoints(shape)
  }

  const simplified: ClassifiedSvgShape[] = []
  for (const shape of shapes) {
    const contour = simplifyCollinear(shape.contour)
    if (!contour) continue
    simplified.push({
      contour,
      holes: shape.holes
        .map(simplifyCollinear)
        .filter((h): h is THREE.Vector2[] => h !== null),
      area: shape.area,
    })
  }

  return simplified.length > 0 ? simplified : null
}

/**
 * Per-layer uniform scale emitted by SvgPathRenderer as a group transform
 * (`<g … transform="scale(f)">`). Path extraction ignores element nesting,
 * so the factor must be applied to the extracted geometry explicitly.
 */
function getGroupScale(svgContent: string): number {
  const match = svgContent.match(/transform="scale\(([^)]+)\)"/)
  if (!match) return 1
  const factor = parseFloat(match[1])
  return Number.isFinite(factor) && factor > 0 ? factor : 1
}

/**
 * Convert SVG content into a merged, extruded Three.js BufferGeometry.
 * Returns null if no valid geometry can be produced.
 */
export function createExtrudeGeometryFromSvg(
  svgContent: string,
  options: SvgToShapesOptions = {},
  depth: number = 1,
): THREE.BufferGeometry | null {
  const { offsetX = 0, offsetY = 0 } = options
  const { height: svgHeight } = getSvgDimensions(svgContent)
  const scale = getGroupScale(svgContent)

  const classified = classifySvgLoops(svgContent)
  if (!classified) return null

  // SVG is y-down; Three.js is y-up. Apply the layer's group scale (about the
  // SVG origin, matching 2D rendering), then flip Y relative to the viewBox
  // height (ExtrudeGeometry normalises winding internally, so no manual
  // reversal).
  const toThree = (p: THREE.Vector2) =>
    new THREE.Vector2(p.x * scale - offsetX, svgHeight - p.y * scale - offsetY)

  const geometries: THREE.BufferGeometry[] = []

  for (const { contour, holes } of classified) {
    const shape = new THREE.Shape(contour.map(toThree))
    shape.holes = holes.map((h) => new THREE.Path(h.map(toThree)))
    geometries.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }))
  }

  if (geometries.length === 0) return null
  if (geometries.length === 1) return geometries[0]

  const merged = mergeGeometries(geometries, false)
  for (const g of geometries) g.dispose()
  return merged
}
