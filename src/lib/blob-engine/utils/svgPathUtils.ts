/**
 * SVG path utilities for converting CurvePrimitive arrays to SVG path strings
 * Uses proper SVG arc commands for quarter circles instead of Bézier approximations
 */

import type { CurvePrimitive, SubgridPoint, CurveType } from "../types"

/**
 * Convert a SubgridPoint (with string coordinates) to numeric coordinates
 */
function subgridToNumber(point: SubgridPoint): { x: number; y: number } {
  return {
    x: parseFloat(point.x),
    y: parseFloat(point.y),
  }
}

/**
 * Format a number for SVG path (3 decimal places max)
 */
function formatSvg(n: number): string {
  return (Math.round(n * 1000) / 1000).toString()
}

/**
 * Convert a single CurvePrimitive to an SVG path segment
 * Uses arc commands for curves and line commands for straight segments
 */
export function curvePrimitiveToSvgSegment(primitive: CurvePrimitive): string {
  const start = subgridToNumber(primitive.ends[0])
  const end = subgridToNumber(primitive.ends[1])
  const { curveType } = primitive

  // For straight lines, just use LineTo
  if (curveType.startsWith("line-") || curveType === "none") {
    return `L ${formatSvg(end.x)} ${formatSvg(end.y)}`
  }

  // For curves, use SVG arc command.
  // Use arcCenter (the actual quarter-circle center) when available;
  // fall back to cell center for backward compatibility.
  const referencePoint = primitive.arcCenter ?? primitive.center
  return calculateArcCommand(start, end, curveType, referencePoint)
}

/**
 * Calculate SVG arc command for quarter circle between start and end points
 * Uses geometric calculation based on arc center and endpoint angles
 */
function calculateArcCommand(
  start: { x: number; y: number },
  end: { x: number; y: number },
  curveType: CurveType,
  center: { x: number; y: number },
): string {
  // Quarter circle radius is 0.5 (half a grid cell)
  const radius = 0.5

  // Calculate angles from arc center to start and end points
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)

  // Calculate angle difference, handling wrap-around
  let angleDiff = endAngle - startAngle
  if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
  if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

  // Sweep flag: 1 for clockwise (positive angle diff), 0 for counter-clockwise
  const sweepFlag = angleDiff > 0 ? 1 : 0

  // SVG Arc syntax: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
  // For quarter circles: rx = ry = radius, rotation = 0, large-arc = 0
  return `A ${formatSvg(radius)} ${formatSvg(radius)} 0 0 ${sweepFlag} ${formatSvg(end.x)} ${formatSvg(end.y)}`
}

/**
 * Convert an ordered array of CurvePrimitives to a complete SVG path string
 * Each array represents a closed path (loop)
 */
export function curvePrimitivesToSvgPath(primitives: CurvePrimitive[]): string {
  if (primitives.length === 0) return ""

  const pathSegments: string[] = []

  // Start with MoveTo command using the first primitive's start point
  const firstStart = subgridToNumber(primitives[0].ends[0])
  pathSegments.push(`M ${formatSvg(firstStart.x)} ${formatSvg(firstStart.y)}`)

  // Add each primitive as a path segment
  for (const primitive of primitives) {
    pathSegments.push(curvePrimitiveToSvgSegment(primitive))
  }

  // Close the path
  pathSegments.push("Z")

  return pathSegments.join(" ")
}

/**
 * Convert multiple ordered arrays of CurvePrimitives to complete SVG paths
 * Each array becomes a separate subpath in the result
 */
export function curvePrimitiveArraysToSvgPaths(
  primitiveArrays: CurvePrimitive[][],
): string[] {
  return primitiveArrays.map((primitives) =>
    curvePrimitivesToSvgPath(primitives),
  )
}

/**
 * Scale SVG path coordinates by a factor (useful for converting from subgrid to pixel coordinates)
 */
export function scaleSvgPath(pathString: string, scaleFactor: number): string {
  return pathString.replace(/(-?\d+\.?\d*)/g, (match) => {
    const num = parseFloat(match)
    return formatSvg(num * scaleFactor)
  })
}

/**
 * Complete utility to convert CurvePrimitive arrays to SVG element with proper scaling
 */
export function createSvgFromCurvePrimitives(
  primitiveArrays: CurvePrimitive[][],
  options: {
    gridSize?: number
    strokeColor?: string
    strokeWidth?: number
    fillColor?: string
    opacity?: number
  } = {},
): string {
  const {
    gridSize = 1,
    strokeColor = "#000",
    strokeWidth = 1,
    fillColor = "none",
    opacity = 1,
  } = options

  const paths = curvePrimitiveArraysToSvgPaths(primitiveArrays)
  const scaledPaths = paths.map((path) => scaleSvgPath(path, gridSize))

  const pathElements = scaledPaths
    .map(
      (path) =>
        `  <path d="${path}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" opacity="${opacity}" />`,
    )
    .join("\n")

  return `<g>\n${pathElements}\n</g>`
}
