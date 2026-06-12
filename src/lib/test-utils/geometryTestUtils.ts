/**
 * Geometry test utilities for asserting extruded 3D output semantically.
 *
 * Raw vertex/index buffers are not interpretable in assertions, so tests
 * verify three robust invariants instead:
 *
 *   1. TOPOLOGY — via classifySvgLoops: number of solid shapes and number of
 *      holes per shape (sorted by area, so assertions are deterministic).
 *
 *   2. FOOTPRINT AREA — mesh volume ÷ depth must equal the ground-truth
 *      even-odd fill area of the SVG loops. The oracle rasterises the loops
 *      with the same arc flattening the extruder uses, so the comparison is
 *      tight (sub-1%) and independent of how loops were classified.
 *
 *   3. WATERTIGHTNESS — every undirected edge of the triangle mesh must be
 *      shared by exactly two triangles. Misassigned holes (e.g. a hole
 *      outside its contour) break this immediately, catching the "webbing"
 *      failure mode without inspecting any coordinates.
 */

import * as THREE from "three"
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js"
import { extractPathsFromSvg } from "@/lib/export/pathUtils"

/** Must match CURVE_DIVISIONS in pathToShape.ts for a tight area oracle. */
const CURVE_DIVISIONS = 16

/** Flatten every SVG loop to a polygon, same way the extruder does. */
export function svgLoopPolygons(svgContent: string): THREE.Vector2[][] {
  const loader = new SVGLoader()
  const polys: THREE.Vector2[][] = []
  for (const d of extractPathsFromSvg(svgContent)) {
    const miniSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`
    const data = loader.parse(miniSvg)
    if (data.paths.length === 0 || data.paths[0].subPaths.length === 0) continue
    const points = data.paths[0].subPaths[0].getPoints(CURVE_DIVISIONS)
    if (points.length >= 3) polys.push(points)
  }
  return polys
}

function crossingCount(px: number, py: number, poly: THREE.Vector2[]): number {
  let count = 0
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) count++
  }
  return count
}

/**
 * Ground-truth even-odd fill area of a set of loops, by rasterisation.
 * Sample points are offset by irrational fractions so they never align with
 * the 0.5 subgrid that all loop geometry lives on.
 */
export function evenOddFillArea(polys: THREE.Vector2[][], resolution = 400): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys)
    for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }
  if (minX === Infinity) return 0
  const dx = (maxX - minX) / resolution
  const dy = (maxY - minY) / resolution
  let inside = 0
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const px = minX + (i + 0.503717) * dx
      const py = minY + (j + 0.497131) * dy
      let total = 0
      for (const poly of polys) total += crossingCount(px, py, poly)
      if (total % 2 === 1) inside++
    }
  }
  return inside * dx * dy
}

/** Signed volume of a triangle mesh (divergence theorem). */
export function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position
  const idx = geo.index
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let volume = 0
  const n = idx ? idx.count : pos.count
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i
    const i1 = idx ? idx.getX(i + 1) : i + 1
    const i2 = idx ? idx.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    volume += a.dot(cross.crossVectors(b, c)) / 6
  }
  return Math.abs(volume)
}

/**
 * Watertightness check: every undirected edge (keyed by rounded vertex
 * positions) must be shared by an EVEN number of triangles. Exactly 2 is the
 * clean 2-manifold case; 4 occurs legitimately where two separate solids are
 * tangent along a line (their side walls coincide). An ODD count means an
 * open surface boundary — a definite defect (missing wall / bad cap).
 * Returns the number of open-boundary edges (0 = watertight).
 */
export function nonManifoldEdgeCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position
  const idx = geo.index
  const n = idx ? idx.count : pos.count

  const vKey = (i: number) => {
    const x = Math.round(pos.getX(i) * 1e5) / 1e5
    const y = Math.round(pos.getY(i) * 1e5) / 1e5
    const z = Math.round(pos.getZ(i) * 1e5) / 1e5
    return `${x},${y},${z}`
  }
  const edgeCounts = new Map<string, number>()
  for (let i = 0; i < n; i += 3) {
    const tri = [
      idx ? idx.getX(i) : i,
      idx ? idx.getX(i + 1) : i + 1,
      idx ? idx.getX(i + 2) : i + 2,
    ].map(vKey)
    // skip degenerate triangles (repeated vertices contribute phantom edges)
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue
    for (let e = 0; e < 3; e++) {
      const v0 = tri[e]
      const v1 = tri[(e + 1) % 3]
      const key = v0 < v1 ? `${v0}|${v1}` : `${v1}|${v0}`
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }
  let bad = 0
  for (const count of edgeCounts.values()) {
    if (count % 2 !== 0) bad++
  }
  return bad
}
