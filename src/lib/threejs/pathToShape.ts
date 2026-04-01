/**
 * Convert SVG paths to Three.js ExtrudeGeometry using SVGLoader.
 *
 * Hole detection is done via createPathGroups (library-based ray-cast
 * containment), which correctly handles arc-heavy blob shapes.
 * Multiple disconnected outer shapes on the same layer are each extruded
 * separately and then merged into a single BufferGeometry.
 */

import * as THREE from "three"
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { createPathGroups, extractPathsFromSvg } from "@/lib/export/pathUtils"

export interface SvgToShapesOptions {
  offsetX?: number
  offsetY?: number
}

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
 * Flip all Y coordinates of a shape relative to `height` (SVG→Three.js coord).
 * Uses getPoints(64) for a smooth approximation of arc segments.
 */
function flipShapeY(shape: THREE.Shape, height: number): THREE.Shape {
  const flipped = new THREE.Shape()
  const points = shape.getPoints(64)
  if (points.length === 0) return flipped
  flipped.moveTo(points[0].x, height - points[0].y)
  for (let i = 1; i < points.length; i++) {
    flipped.lineTo(points[i].x, height - points[i].y)
  }
  return flipped
}

/**
 * Reverse the winding order of a shape.
 * Required for outer contours after SVG→Three.js Y-flip so that ExtrudeGeometry
 * treats them as solid filled regions.
 */
function reverseWinding(shape: THREE.Shape): THREE.Shape {
  const reversed = new THREE.Shape()
  const points = shape.getPoints(64)
  if (points.length === 0) return reversed
  reversed.moveTo(points[points.length - 1].x, points[points.length - 1].y)
  for (let i = points.length - 2; i >= 0; i--) {
    reversed.lineTo(points[i].x, points[i].y)
  }
  return reversed
}

/**
 * Parse a single SVG path d-string into a THREE.Shape via SVGLoader.
 * Returns null if the path cannot be parsed.
 */
function dStringToThreeShape(d: string, loader: SVGLoader): THREE.Shape | null {
  const miniSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`
  const data = loader.parse(miniSvg)
  if (data.paths.length === 0) return null
  const shapes = SVGLoader.createShapes(data.paths[0])
  return shapes.length > 0 ? shapes[0] : null
}

/**
 * Convert SVG content into a merged Three.js BufferGeometry by:
 *  1. Extracting all path d-strings.
 *  2. Grouping them into outer shapes + holes via library-based containment.
 *  3. Extruding each group into a THREE.ExtrudeGeometry.
 *  4. Merging all group geometries into one BufferGeometry.
 *
 * Returns null if no valid geometry can be produced.
 */
export function createExtrudeGeometryFromSvg(
  svgContent: string,
  options: SvgToShapesOptions = {},
  depth: number = 1,
): THREE.BufferGeometry | null {
  const { offsetX = 0, offsetY = 0 } = options
  const { height: svgHeight } = getSvgDimensions(svgContent)

  const ds = extractPathsFromSvg(svgContent)
  if (ds.length === 0) return null

  const groups = createPathGroups(ds)
  if (groups.length === 0) return null

  const loader = new SVGLoader()
  const geometries: THREE.BufferGeometry[] = []

  for (const group of groups) {
    // --- Outer shape ---
    const outerRaw = dStringToThreeShape(group.outer, loader)
    if (!outerRaw) continue

    let outerShape = flipShapeY(outerRaw, svgHeight)
    outerShape = reverseWinding(outerShape)

    // --- Holes ---
    for (const holePath of group.holes) {
      const holeRaw = dStringToThreeShape(holePath, loader)
      if (!holeRaw) continue
      const holeShape = flipShapeY(holeRaw, svgHeight)
      outerShape.holes.push(holeShape)
    }

    // --- Optional XY offset ---
    if (offsetX !== 0 || offsetY !== 0) {
      const translated = new THREE.Shape()
      const pts = outerShape.getPoints(64)
      translated.moveTo(pts[0].x - offsetX, pts[0].y - offsetY)
      for (let i = 1; i < pts.length; i++) {
        translated.lineTo(pts[i].x - offsetX, pts[i].y - offsetY)
      }
      translated.holes = outerShape.holes.map((h) => {
        const th = new THREE.Shape()
        const hp = h.getPoints(64)
        th.moveTo(hp[0].x - offsetX, hp[0].y - offsetY)
        for (let i = 1; i < hp.length; i++) {
          th.lineTo(hp[i].x - offsetX, hp[i].y - offsetY)
        }
        return th
      })
      outerShape = translated
    }

    const extruded = new THREE.ExtrudeGeometry(outerShape, {
      depth,
      bevelEnabled: false,
    })
    geometries.push(extruded)
  }

  if (geometries.length === 0) return null
  if (geometries.length === 1) return geometries[0]

  // Merge multiple disconnected shapes (e.g. two donuts on the same layer)
  const merged = mergeGeometries(geometries, false)
  // Dispose individual geometries since they're merged
  for (const g of geometries) g.dispose()
  return merged
}
