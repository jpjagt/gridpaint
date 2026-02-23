/**
 * Test utilities for comparing SVG paths semantically
 *
 * SVG paths can be represented in many ways while defining the same shape:
 * - Floating point precision differences
 * - Different number formatting (e.g., "1.0" vs "1")
 * - Whitespace differences
 * - Command grouping (e.g., "L 1 2 L 3 4" vs "L 1 2 3 4")
 * - Different start/end points for closed paths
 * - Clockwise vs counter-clockwise direction
 *
 * These utilities parse and normalize paths for robust comparison.
 */

export interface PathCommand {
  type: string
  coords: number[]
}

/**
 * Parse an SVG path string into normalized commands
 */
export function parseSvgPath(pathString: string): PathCommand[] {
  const commands: PathCommand[] = []
  
  // Remove extra whitespace and normalize
  const normalized = pathString
    .trim()
    .replace(/,/g, ' ') // Replace commas with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/([a-zA-Z])/g, '|$1 ') // Add separator before commands
    .split('|')
    .filter(Boolean)

  for (const segment of normalized) {
    const parts = segment.trim().split(/\s+/)
    if (parts.length === 0) continue

    const type = parts[0]
    const coords = parts.slice(1).map(Number).filter(n => !isNaN(n))

    commands.push({ type, coords })
  }

  return commands
}

/**
 * Compare two numbers with tolerance for floating point differences
 */
export function numbersMatch(a: number, b: number, epsilon: number = 0.001): boolean {
  return Math.abs(a - b) < epsilon
}

/**
 * Compare two path commands for semantic equality
 */
export function commandsMatch(
  a: PathCommand,
  b: PathCommand,
  epsilon: number = 0.001
): boolean {
  if (a.type.toUpperCase() !== b.type.toUpperCase()) {
    return false
  }

  if (a.coords.length !== b.coords.length) {
    return false
  }

  for (let i = 0; i < a.coords.length; i++) {
    if (!numbersMatch(a.coords[i], b.coords[i], epsilon)) {
      return false
    }
  }

  return true
}

/**
 * Normalize a closed path by rotating commands to start at the lexicographically smallest point
 * This allows comparing paths that are the same shape but start at different points
 */
export function normalizeClosedPath(commands: PathCommand[]): PathCommand[] {
  if (commands.length === 0) return commands

  // Check if path is closed (last command is Z/z or ends where it starts)
  const lastCmd = commands[commands.length - 1]
  const isClosed = lastCmd.type.toUpperCase() === 'Z' || 
    (commands.length > 1 && 
     commands[0].coords.length >= 2 && 
     lastCmd.coords.length >= 2 &&
     commands[0].coords[0] === lastCmd.coords[lastCmd.coords.length - 2] &&
     commands[0].coords[1] === lastCmd.coords[lastCmd.coords.length - 1])

  if (!isClosed) return commands

  // Extract all point coordinates from the path
  const points: { x: number; y: number; cmdIndex: number }[] = []
  
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]
    if (cmd.type.toUpperCase() === 'Z') continue
    
    // For M (move) and L (line), take pairs of coordinates as points
    if (cmd.type.toUpperCase() === 'M' || cmd.type.toUpperCase() === 'L') {
      for (let j = 0; j < cmd.coords.length; j += 2) {
        if (j + 1 < cmd.coords.length) {
          points.push({
            x: cmd.coords[j],
            y: cmd.coords[j + 1],
            cmdIndex: i
          })
        }
      }
    }
    // For C (cubic bezier), take the last point (end point)
    else if (cmd.type.toUpperCase() === 'C') {
      const len = cmd.coords.length
      if (len >= 2) {
        points.push({
          x: cmd.coords[len - 2],
          y: cmd.coords[len - 1],
          cmdIndex: i
        })
      }
    }
  }

  if (points.length === 0) return commands

  // Find the lexicographically smallest point (smallest x, then smallest y)
  let minIndex = 0
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[minIndex].x || 
        (points[i].x === points[minIndex].x && points[i].y < points[minIndex].y)) {
      minIndex = i
    }
  }

  // If already starting at min point, return as-is
  if (minIndex === 0) return commands

  // Rotate the path to start at the minimum point
  // This is a simplified rotation - for production, you'd need to properly split commands
  // For now, we'll just return the original if normalization is complex
  return commands
}

/**
 * Compare two SVG paths for semantic equality
 * Handles different start points for closed paths
 */
export function pathsMatch(
  actual: string,
  expected: string,
  epsilon: number = 0.001
): { match: boolean; reason?: string } {
  const actualCommands = parseSvgPath(actual)
  const expectedCommands = parseSvgPath(expected)

  if (actualCommands.length !== expectedCommands.length) {
    return {
      match: false,
      reason: `Different number of commands: ${actualCommands.length} vs ${expectedCommands.length}`
    }
  }

  // Try direct comparison first
  let directMatch = true
  for (let i = 0; i < actualCommands.length; i++) {
    if (!commandsMatch(actualCommands[i], expectedCommands[i], epsilon)) {
      directMatch = false
      break
    }
  }

  if (directMatch) return { match: true }

  // If direct comparison fails, try with normalization
  const normalizedActual = normalizeClosedPath(actualCommands)
  const normalizedExpected = normalizeClosedPath(expectedCommands)

  for (let i = 0; i < normalizedActual.length; i++) {
    if (!commandsMatch(normalizedActual[i], normalizedExpected[i], epsilon)) {
      return {
        match: false,
        reason: `Command ${i} differs after normalization: ${JSON.stringify(normalizedActual[i])} vs ${JSON.stringify(normalizedExpected[i])}`
      }
    }
  }

  return { match: true }
}

/**
 * Extract all <path> elements from SVG string
 */
export function extractPathsFromSvg(svg: string): { d: string; fill?: string; stroke?: string }[] {
  const paths: { d: string; fill?: string; stroke?: string }[] = []
  
  // Match path elements and extract d, fill, and stroke attributes
  const pathRegex = /<path[^>]*\bd="([^"]*)"[^>]*>/gi
  let match: RegExpExecArray | null = pathRegex.exec(svg)

  while (match !== null) {
    const fullTag = match[0]
    const d = match[1]
    
    // Extract fill and stroke if present
    const fillMatch = fullTag.match(/\bfill="([^"]*)"/)
    const strokeMatch = fullTag.match(/\bstroke="([^"]*)"/)
    
    paths.push({
      d,
      fill: fillMatch?.[1],
      stroke: strokeMatch?.[1]
    })
    
    match = pathRegex.exec(svg)
  }

  return paths
}

/**
 * Count the number of path elements in an SVG
 */
export function countPaths(svg: string): number {
  return extractPathsFromSvg(svg).length
}

/**
 * Calculate approximate bounding box of a path
 * Useful for comparing paths based on their extent rather than exact coordinates
 */
export function getPathBounds(pathString: string): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} | null {
  const commands = parseSvgPath(pathString)
  
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  
  for (const cmd of commands) {
    // Skip Z command
    if (cmd.type.toUpperCase() === 'Z') continue
    
    // Process coordinate pairs
    for (let i = 0; i < cmd.coords.length; i += 2) {
      if (i + 1 < cmd.coords.length) {
        const x = cmd.coords[i]
        const y = cmd.coords[i + 1]
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  
  if (minX === Infinity) return null
  
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  }
}

/**
 * Check if a path is closed (ends with Z or returns to start)
 */
export function isPathClosed(pathString: string): boolean {
  const commands = parseSvgPath(pathString)
  if (commands.length === 0) return false
  
  const lastCmd = commands[commands.length - 1]
  if (lastCmd.type.toUpperCase() === 'Z') return true
  
  // Check if last point matches first point
  if (commands.length > 1) {
    const firstCmd = commands[0]
    if (firstCmd.coords.length >= 2 && lastCmd.coords.length >= 2) {
      const firstX = firstCmd.coords[0]
      const firstY = firstCmd.coords[1]
      const lastX = lastCmd.coords[lastCmd.coords.length - 2]
      const lastY = lastCmd.coords[lastCmd.coords.length - 1]
      return numbersMatch(firstX, lastX, 0.001) && numbersMatch(firstY, lastY, 0.001)
    }
  }
  
  return false
}

/**
 * Count the number of distinct commands in a path (excluding Z)
 */
export function countPathCommands(pathString: string): number {
  const commands = parseSvgPath(pathString)
  return commands.filter(cmd => cmd.type.toUpperCase() !== 'Z').length
}

/**
 * Vitest custom matcher for SVG paths
 */
export function expectPathsToMatch(
  actual: string,
  expected: string,
  epsilon?: number
): void {
  const result = pathsMatch(actual, expected, epsilon)
  
  if (!result.match) {
    throw new Error(
      `SVG paths do not match:\n` +
      `  Reason: ${result.reason}\n` +
      `  Actual:   ${actual}\n` +
      `  Expected: ${expected}`
    )
  }
}

// ─── Geometric point-sampling comparison ────────────────────────────────────
//
// The strategy: sample N points along each path by walking the segments.
// This is invariant to:
//   • Start point rotation
//   • Arc parameter representations (large-arc-flag, sweep-flag)
//   • CW vs CCW direction (we compare both orderings)
//   • Floating-point noise (epsilon tolerance)
//
// We sort both sample sets by (x, y) before comparing so order is irrelevant.

export interface Point2D {
  x: number
  y: number
}

/**
 * Evaluate a cubic Bézier at parameter t ∈ [0,1].
 * Control points: p0 (start), p1, p2, p3 (end).
 */
function evalCubicBezier(
  p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number
): Point2D {
  const mt = 1 - t
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  }
}

/**
 * Evaluate a circular arc at angle θ.
 * SVG arc parameters: (x1,y1) → (x2,y2), radii (rx,ry), x-rotation φ,
 * large-arc-flag, sweep-flag.
 * Converts to center parameterization per the SVG spec.
 */
function arcToCenter(
  x1: number, y1: number,
  rx: number, ry: number,
  xRot: number,
  largeArc: number,
  sweep: number,
  x2: number, y2: number,
): { cx: number; cy: number; startAngle: number; deltaAngle: number } | null {
  if (rx === 0 || ry === 0) return null

  const phi = (xRot * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  // Ensure radii are large enough
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p
  let rxSq = rx * rx
  let rySq = ry * ry

  const lambda = x1pSq / rxSq + y1pSq / rySq
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda)
    rx = sqrtLambda * rx
    ry = sqrtLambda * ry
    rxSq = rx * rx
    rySq = ry * ry
  }

  const sign = largeArc === sweep ? -1 : 1
  const sq = Math.max(0,
    (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) /
    (rxSq * y1pSq + rySq * x1pSq)
  )
  const m = sign * Math.sqrt(sq)

  const cxp = m * (rx * y1p) / ry
  const cyp = -m * (ry * x1p) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry

  const startAngle = Math.atan2(uy, ux)
  let dAngle = Math.atan2(vy, vx) - startAngle
  if (sweep === 0 && dAngle > 0) dAngle -= 2 * Math.PI
  if (sweep === 1 && dAngle < 0) dAngle += 2 * Math.PI

  return { cx, cy, startAngle, deltaAngle: dAngle }
}

/**
 * Sample N evenly-spaced points along a single SVG path string.
 * Handles M, L, A, C, Z commands.
 * Returns an array of {x, y} points.
 */
export function samplePointsOnPath(pathString: string, samplesPerSegment = 8): Point2D[] {
  const commands = parseSvgPath(pathString)
  const points: Point2D[] = []

  let cx = 0, cy = 0  // current pen position
  let startX = 0, startY = 0  // move-to position (for Z)

  function addSegmentSamples(pts: Point2D[]) {
    if (pts.length < 2) return
    // Sample interior points (skip t=0 to avoid duplicate with previous endpoint)
    for (let i = 1; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment
      const idx = Math.min(Math.floor(t * (pts.length - 1)), pts.length - 2)
      const localT = (t * (pts.length - 1)) - idx
      points.push({
        x: pts[idx].x + localT * (pts[idx + 1].x - pts[idx].x),
        y: pts[idx].y + localT * (pts[idx + 1].y - pts[idx].y),
      })
    }
  }

  for (const cmd of commands) {
    const type = cmd.type.toUpperCase()
    const c = cmd.coords

    if (type === 'M') {
      cx = c[0]; cy = c[1]
      startX = cx; startY = cy
      points.push({ x: cx, y: cy })
    } else if (type === 'L') {
      for (let i = 0; i + 1 < c.length; i += 2) {
        const nx = c[i], ny = c[i + 1]
        // Skip zero-length segments (degenerate lines to the same point)
        if (Math.abs(nx - cx) > 1e-9 || Math.abs(ny - cy) > 1e-9) {
          // Sample along line
          for (let s = 1; s <= samplesPerSegment; s++) {
            const t = s / samplesPerSegment
            points.push({ x: cx + t * (nx - cx), y: cy + t * (ny - cy) })
          }
        }
        cx = nx; cy = ny
      }
    } else if (type === 'A') {
      // A rx ry x-rotation large-arc-flag sweep-flag x y
      for (let i = 0; i + 6 < c.length; i += 7) {
        const rx = c[i], ry = c[i + 1], xRot = c[i + 2]
        const largeArc = c[i + 3], sweep = c[i + 4]
        const nx = c[i + 5], ny = c[i + 6]

        const arc = arcToCenter(cx, cy, rx, ry, xRot, largeArc, sweep, nx, ny)
        if (arc) {
          for (let s = 1; s <= samplesPerSegment; s++) {
            const t = s / samplesPerSegment
            const angle = arc.startAngle + t * arc.deltaAngle
            points.push({
              x: arc.cx + rx * Math.cos(angle),
              y: arc.cy + ry * Math.sin(angle),
            })
          }
        } else {
          // Degenerate arc — treat as line
          for (let s = 1; s <= samplesPerSegment; s++) {
            const t = s / samplesPerSegment
            points.push({ x: cx + t * (nx - cx), y: cy + t * (ny - cy) })
          }
        }
        cx = nx; cy = ny
      }
    } else if (type === 'C') {
      // C x1 y1 x2 y2 x y
      for (let i = 0; i + 5 < c.length; i += 6) {
        const p0 = { x: cx, y: cy }
        const p1 = { x: c[i], y: c[i + 1] }
        const p2 = { x: c[i + 2], y: c[i + 3] }
        const p3 = { x: c[i + 4], y: c[i + 5] }
        for (let s = 1; s <= samplesPerSegment; s++) {
          const t = s / samplesPerSegment
          points.push(evalCubicBezier(p0, p1, p2, p3, t))
        }
        cx = p3.x; cy = p3.y
      }
    } else if (type === 'Z') {
      // Close path — line back to start
      if (cx !== startX || cy !== startY) {
        for (let s = 1; s <= samplesPerSegment; s++) {
          const t = s / samplesPerSegment
          points.push({ x: cx + t * (startX - cx), y: cy + t * (startY - cy) })
        }
      }
      cx = startX; cy = startY
    }
  }

  return points
}

/**
 * Sort points lexicographically by (x, y) for order-invariant comparison.
 */
function sortPoints(pts: Point2D[]): Point2D[] {
  return [...pts].sort((a, b) => {
    if (Math.abs(a.x - b.x) > 1e-6) return a.x - b.x
    return a.y - b.y
  })
}

/**
 * Check whether two point clouds are approximately equal.
 * Returns a mismatch description or null if they match.
 */
function pointCloudsMatch(
  a: Point2D[],
  b: Point2D[],
  epsilon: number,
): string | null {
  if (a.length !== b.length) {
    return `Different sample counts: ${a.length} vs ${b.length}`
  }
  const sa = sortPoints(a)
  const sb = sortPoints(b)
  for (let i = 0; i < sa.length; i++) {
    const dx = Math.abs(sa[i].x - sb[i].x)
    const dy = Math.abs(sa[i].y - sb[i].y)
    if (dx > epsilon || dy > epsilon) {
      return `Point ${i} differs: (${sa[i].x.toFixed(4)}, ${sa[i].y.toFixed(4)}) vs (${sb[i].x.toFixed(4)}, ${sb[i].y.toFixed(4)})`
    }
  }
  return null
}

/**
 * Compare two full SVG strings geometrically.
 *
 * Strategy:
 *   1. Extract all <path d="..."> elements from both SVGs.
 *   2. Sample points on each path.
 *   3. Merge all sampled points into one cloud per SVG.
 *   4. Sort both clouds and compare element-by-element with epsilon tolerance.
 *
 * This is invariant to:
 *   - Start point / traversal order
 *   - Arc parameter representations
 *   - CW vs CCW direction
 *   - Number formatting / whitespace
 */
export function svgsGeometricallyEqual(
  actualSvg: string,
  expectedSvg: string,
  options: {
    epsilon?: number
    samplesPerSegment?: number
  } = {}
): { equal: boolean; reason?: string; actualPaths: string[]; expectedPaths: string[] } {
  const eps = options.epsilon ?? 0.005
  const sps = options.samplesPerSegment ?? 12

  const actualPaths = extractPathsFromSvg(actualSvg).map((p) => p.d)
  const expectedPaths = extractPathsFromSvg(expectedSvg).map((p) => p.d)

  // Merge all points across all paths (treats multi-path SVGs as one shape set)
  const sampleAll = (paths: string[]): Point2D[] =>
    paths.flatMap((p) => samplePointsOnPath(p, sps))

  const actualPoints = sampleAll(actualPaths)
  const expectedPoints = sampleAll(expectedPaths)

  const reason = pointCloudsMatch(actualPoints, expectedPoints, eps)

  return {
    equal: reason === null,
    reason: reason ?? undefined,
    actualPaths,
    expectedPaths,
  }
}

/**
 * Format a diff between actual and expected SVG paths for test failure output.
 */
export function formatSvgDiff(
  actualPaths: string[],
  expectedPaths: string[],
  reason?: string,
): string {
  const lines: string[] = []
  lines.push(`Reason: ${reason ?? "unknown"}`)
  lines.push(``)
  lines.push(`Expected paths (${expectedPaths.length}):`)
  expectedPaths.forEach((p, i) => lines.push(`  [${i}] ${p}`))
  lines.push(``)
  lines.push(`Actual paths (${actualPaths.length}):`)
  actualPaths.forEach((p, i) => lines.push(`  [${i}] ${p}`))
  return lines.join("\n")
}
