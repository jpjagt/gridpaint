/**
 * SvgPathRenderer - Generates continuous SVG paths by stitching quadrant arcs
 *
 * Strategy
 * - Convert each roundedCorner/diagonalBridge primitive into a cubic Bézier arc
 *   expressed in world coordinates (after quadrant rotation and translation).
 * - Build an adjacency map keyed by quantized endpoints so matching endpoints
 *   connect deterministically.
 * - Trace closed loops by walking unused segments endpoint-to-endpoint.
 * - Emit one SVG subpath per loop: M … C … Z
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  CompositeGeometry,
  CurvePrimitive,
  GridPoint,
  RenderStyle,
  SubgridPoint,
} from "../types"
import {
  Renderer,
  type RenderOptions,
  type ViewportTransform,
} from "./Renderer"
import { magicNr } from "@/lib/constants"
import {
  curvePrimitiveArraysToSvgPaths,
  scaleSvgPath,
} from "../utils/svgPathUtils"

type Vec = { x: number; y: number }

interface PathSegment {
  // Cubic Bézier segment
  start: Vec
  cp1: Vec
  cp2: Vec
  end: Vec
  // Reference for debugging
  primitiveIndex: number
}

interface OrientedRef {
  segIndex: number
  at: "start" | "end" // which endpoint of the segment this ref is attached to
}

const getSubgridEnds = (
  primitive: BlobPrimitive,
): [SubgridPoint, SubgridPoint] => {
  // SubgridPoint.x and y = string (-0.5, 0, 0.5, 1, 1.5, ..)
  // each point has nine subgrid points (but center one is never used)
  // quadrant: 0=SE, 1=SW, 2=NW, 3=NE
  // quadrant + curve type determines which two edges the curve connects
  // e.g. quadrant=0 + convex => south to east
  // e.g. quadrant=1 + convex => south to west
  // e.g. quadrant=1 + line-south => south-west and south-center
  const cx = primitive.center.x
  const cy = primitive.center.y
  const quadrant =
    {
      0: "SE",
      1: "SW",
      2: "NW",
      3: "NE",
    }[primitive.quadrant] || primitive.quadrant
  const curveType = primitive.curveType

  const p = {
    bl: { x: (cx - 0.5).toString(), y: (cy + 0.5).toString() },
    br: { x: (cx + 0.5).toString(), y: (cy + 0.5).toString() },
    tl: { x: (cx - 0.5).toString(), y: (cy - 0.5).toString() },
    tr: { x: (cx + 0.5).toString(), y: (cy - 0.5).toString() },
    tc: { x: cx.toString(), y: (cy - 0.5).toString() },
    bc: { x: cx.toString(), y: (cy + 0.5).toString() },
    cl: { x: (cx - 0.5).toString(), y: cy.toString() },
    cr: { x: (cx + 0.5).toString(), y: cy.toString() },
  }

  switch (curveType) {
    case "convex-south-east":
      return [p.cr, p.bc]
    case "convex-south-west":
      return [p.cl, p.bc]
    case "convex-north-west":
      return [p.tc, p.cl]
    case "convex-north-east":
      return [p.tc, p.cr]
    case "line-south":
      if (quadrant === "SE") return [p.bc, p.br]
      else if (quadrant === "SW") return [p.bl, p.bc]
      else throw new Error("invalid primitive")
    case "line-north":
      if (quadrant === "NE") return [p.tc, p.tr]
      else if (quadrant === "NW") return [p.tl, p.tc]
      else throw new Error("invalid primitive")
    case "line-east":
      if (quadrant === "SE") return [p.cr, p.br]
      else if (quadrant === "NE") return [p.cr, p.tr]
      else throw new Error("invalid primitive")
    case "line-west":
      if (quadrant === "SW") return [p.cl, p.bl]
      else if (quadrant === "NW") return [p.cl, p.tl]
      else throw new Error("invalid primitive")
    default:
      throw new Error(`Unknown curve type: ${curveType}`)
  }
}

function createOrderedPaths(
  curvePrimitives: CurvePrimitive[],
): CurvePrimitive[][] {
  console.log(
    "🚀 createOrderedPaths starting with",
    curvePrimitives.length,
    "primitives",
  )

  // Deep copy primitives so we can modify without affecting original
  const remainingPrimitives = [...curvePrimitives]
  const paths: CurvePrimitive[][] = []

  // Helper to check if two points are the same
  const pointsEqual = (p1: SubgridPoint, p2: SubgridPoint): boolean =>
    p1.x === p2.x && p1.y === p2.y

  let pathIndex = 0
  // Continue until we've used all primitives
  while (remainingPrimitives.length > 0) {
    console.log(
      `\n📍 Starting path ${pathIndex}, remaining primitives:`,
      remainingPrimitives.length,
    )

    // Start a new path with the first available primitive
    const firstPrimitive = remainingPrimitives.shift()!
    const currentPath: CurvePrimitive[] = [firstPrimitive]
    console.log(
      `  🎯 First primitive: ${firstPrimitive.ends[0].x},${firstPrimitive.ends[0].y} → ${firstPrimitive.ends[1].x},${firstPrimitive.ends[1].y} (${firstPrimitive.curveType})`,
    )

    let pathComplete = false
    let stepCount = 0

    // Continue until the path is closed or we can't add more primitives
    while (!pathComplete && stepCount < 99999) {
      // Safety limit
      stepCount++
      const lastCurve = currentPath[currentPath.length - 1]
      const endPoint = lastCurve.ends[1] // The end point of the last curve
      console.log(
        `    🔍 Step ${stepCount}: Looking for connection from ${endPoint.x},${endPoint.y}`,
      )

      // Find a primitive that connects to this end point
      const nextPrimitiveIndex = remainingPrimitives.findIndex(
        (p) =>
          pointsEqual(p.ends[0], endPoint) || pointsEqual(p.ends[1], endPoint),
      )

      console.log(`    🔍 Found connection at index:`, nextPrimitiveIndex)

      if (nextPrimitiveIndex === -1) {
        // If we can't find a next primitive, check if we can close the loop
        // by connecting back to the start of the current path
        const startPoint = currentPath[0].ends[0]
        const canClose =
          currentPath.length > 1 && pointsEqual(endPoint, startPoint)
        console.log(
          `    ❌ No next primitive found. Can close loop? ${canClose} (${endPoint.x},${endPoint.y} vs ${startPoint.x},${startPoint.y})`,
        )

        if (canClose) {
          console.log(
            `    ✅ Path ${pathIndex} closed as loop with ${currentPath.length} primitives`,
          )
          pathComplete = true // Path forms a closed loop
        } else {
          console.log(
            `    ! Path ${pathIndex} ends incomplete with ${currentPath.length} primitives`,
          )
          // This path can't be continued
          pathComplete = true
        }
      } else {
        // Found a connecting primitive
        const nextPrimitive = remainingPrimitives.splice(
          nextPrimitiveIndex,
          1,
        )[0]

        const needsFlip = pointsEqual(nextPrimitive.ends[1], endPoint)
        console.log(
          `    ➡ Adding primitive: ${nextPrimitive.ends[0].x},${nextPrimitive.ends[0].y} → ${nextPrimitive.ends[1].x},${nextPrimitive.ends[1].y} (${nextPrimitive.curveType}), needs flip: ${needsFlip}`,
        )

        // If nextPrimitive connects by its end point, we need to flip it
        if (needsFlip) {
          // Flip the primitive's direction by swapping its ends
          const temp = nextPrimitive.ends[0]
          nextPrimitive.ends[0] = nextPrimitive.ends[1]
          nextPrimitive.ends[1] = temp
          console.log(
            `    🔄 After flip: ${nextPrimitive.ends[0].x},${nextPrimitive.ends[0].y} → ${nextPrimitive.ends[1].x},${nextPrimitive.ends[1].y}`,
          )
        }

        currentPath.push(nextPrimitive)
      }
    }

    if (stepCount >= 99999) {
      console.warn(`! Path ${pathIndex} hit safety limit of 99999 steps`)
    }

    console.log(
      `✅ Path ${pathIndex} complete with ${currentPath.length} primitives`,
    )

    // Force clockwise ordering
    const clockwisePath = ensureClockwiseOrder(currentPath)
    paths.push(clockwisePath)
    pathIndex++
  }

  console.log(`🏁 createOrderedPaths complete: ${paths.length} paths`)
  return paths
}

/**
 * Ensures a path is ordered clockwise using the shoelace formula
 * If counter-clockwise, reverses the path and flips all primitive directions
 */
function ensureClockwiseOrder(path: CurvePrimitive[]): CurvePrimitive[] {
  if (path.length < 3) return path // Need at least 3 points for direction

  // Calculate signed area using shoelace formula
  let signedArea = 0
  for (let i = 0; i < path.length; i++) {
    const current = path[i].ends[0] // Start point of current primitive
    const next = path[(i + 1) % path.length].ends[0] // Start point of next primitive

    const x1 = parseFloat(current.x)
    const y1 = parseFloat(current.y)
    const x2 = parseFloat(next.x)
    const y2 = parseFloat(next.y)

    signedArea += (x2 - x1) * (y2 + y1)
  }

  // If signedArea > 0, path is clockwise; if < 0, counter-clockwise
  const isClockwise = signedArea > 0

  if (isClockwise) {
    console.log(`Path is already clockwise (area: ${signedArea})`)
    return path
  }

  console.log(`Path is counter-clockwise (area: ${signedArea}), reversing...`)

  // Reverse the path and flip each primitive's direction
  const reversedPath = path
    .slice()
    .reverse()
    .map((primitive) => ({
      ...primitive,
      ends: [primitive.ends[1], primitive.ends[0]] as [
        SubgridPoint,
        SubgridPoint,
      ],
    }))

  return reversedPath
}

export class SvgPathRenderer extends Renderer {
  constructor(debugMode = false) {
    super(debugMode)
  }

  // Not used (SVG is string-based), but we keep the signature
  clear(): void {}

  renderComposite(geometry: CompositeGeometry, options: RenderOptions): string {
    const layerSvgs = geometry.layers.map((lg) =>
      this.renderLayer(lg.geometry, options.style, options.transform),
    )

    const content = layerSvgs.filter(Boolean).join("\n")

    // Calculate viewport from bounding box (using subgrid coordinates directly)
    const { min, max } = geometry.boundingBox
    const viewW = Math.max(1, Math.ceil(max.x - min.x + 1))
    const viewH = Math.max(1, Math.ceil(max.y - min.y + 1))

    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min.x} ${min.y} ${viewW} ${viewH}">\n${content}\n</svg>`
  }

  renderLayer(
    geometry: BlobGeometry,
    style: RenderStyle,
    transform: ViewportTransform,
  ): string {
    const curvePrimitives: CurvePrimitive[] = geometry.primitives
      .filter((primitive) => primitive.curveType !== "none")
      .map((primitive) => ({
        center: { x: primitive.center.x, y: primitive.center.y },
        quadrant: primitive.quadrant,
        ends: getSubgridEnds(primitive),
        curveType: primitive.curveType,
        size: primitive.size,
      }))

    console.log(
      curvePrimitives
        .map(
          (cp) =>
            `[${cp.center.x},${cp.center.y} :: ${cp.curveType}]: x=${cp.ends[0].x},y=${cp.ends[0].y} → x=${cp.ends[1].x},y=${cp.ends[1].y}`,
        )
        .join("\n"),
    )

    const paths = createOrderedPaths(curvePrimitives)
    console.log({ paths })

    // Convert to SVG paths using the new utility (using subgrid coordinates directly)
    const svgPaths = curvePrimitiveArraysToSvgPaths(paths)

    // Emit SVG paths
    const stroke = style.strokeColor || style.fillColor || "#000"
    const strokeWidth = style.strokeWidth ?? 0.05
    const opacity = style.opacity ?? 1
    const fill = style.fillColor || "none"

    const pathElements = svgPaths
      .map((path) => `  <path d="${path}" />`)
      .join("\n")

    return `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}">\n${pathElements}\n</g>`
  }

  renderPrimitive(): void {
    // Not used for SVG path merging; we render whole layers.
  }
}
