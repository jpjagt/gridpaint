// Final Blob Path Generator - Connects boundary segments into clean continuous paths

class FinalBlobPathGenerator {
  constructor(points, gridSize = 20, borderWidth = 2) {
    this.points = new Set(points)
    this.gridSize = gridSize
    this.borderWidth = borderWidth
    this.r = gridSize / 2 + borderWidth
    this.k = 0.553
    this.tolerance = 0.1 // For connecting segments
  }

  hasPoint(x, y) {
    return this.points.has(`${x},${y}`)
  }

  getNeighbors(x, y) {
    return {
      N: this.hasPoint(x, y - 1),
      E: this.hasPoint(x + 1, y),
      S: this.hasPoint(x, y + 1),
      W: this.hasPoint(x - 1, y),
      NE: this.hasPoint(x + 1, y - 1),
      SE: this.hasPoint(x + 1, y + 1),
      SW: this.hasPoint(x - 1, y + 1),
      NW: this.hasPoint(x - 1, y - 1),
    }
  }

  classifyQuadrant(neighbors, quadrant) {
    let orthogonal1, orthogonal2, diagonal

    switch (quadrant) {
      case "SE":
        orthogonal1 = neighbors.E
        orthogonal2 = neighbors.S
        diagonal = neighbors.SE
        break
      case "SW":
        orthogonal1 = neighbors.S
        orthogonal2 = neighbors.W
        diagonal = neighbors.SW
        break
      case "NW":
        orthogonal1 = neighbors.W
        orthogonal2 = neighbors.N
        diagonal = neighbors.NW
        break
      case "NE":
        orthogonal1 = neighbors.N
        orthogonal2 = neighbors.E
        diagonal = neighbors.NE
        break
    }

    if (orthogonal1 || orthogonal2 || (orthogonal1 && orthogonal2)) return 0
    if (!orthogonal1 && !orthogonal2 && !diagonal) return 1
    if (!orthogonal1 && !orthogonal2 && diagonal) return 2
    return 1
  }

  // Generate all boundary segments for all points
  generateAllBoundarySegments() {
    const allSegments = []

    Array.from(this.points).forEach((pointStr) => {
      const [x, y] = pointStr.split(",").map(Number)
      const neighbors = this.getNeighbors(x, y)
      const centerX = x * this.gridSize
      const centerY = y * this.gridSize
      const r = this.r
      const k = this.k

      // Check each quadrant for external corners
      const quadrants = ["SE", "SW", "NW", "NE"]

      quadrants.forEach((quadrant) => {
        const primitiveType = this.classifyQuadrant(neighbors, quadrant)

        // Generate segments for both external corners AND diagonal bridges
        if (primitiveType === 1 || primitiveType === 2) {
          const segment = this.generateCornerSegment(
            centerX,
            centerY,
            quadrant,
            r,
            k,
          )
          if (segment) {
            segment.sourcePoint = { x, y }
            segment.quadrant = quadrant
            segment.primitiveType = primitiveType
            allSegments.push(segment)
          }
        }
      })
    })

    return allSegments
  }

  generateCornerSegment(centerX, centerY, quadrant, r, k) {
    switch (quadrant) {
      case "SE":
        return {
          start: { x: centerX + r, y: centerY },
          cp1: { x: centerX + r, y: centerY + r * k },
          cp2: { x: centerX + r * k, y: centerY + r },
          end: { x: centerX, y: centerY + r },
          type: "bezier",
        }
      case "SW":
        return {
          start: { x: centerX, y: centerY + r },
          cp1: { x: centerX - r * k, y: centerY + r },
          cp2: { x: centerX - r, y: centerY + r * k },
          end: { x: centerX - r, y: centerY },
          type: "bezier",
        }
      case "NW":
        return {
          start: { x: centerX - r, y: centerY },
          cp1: { x: centerX - r, y: centerY - r * k },
          cp2: { x: centerX - r * k, y: centerY - r },
          end: { x: centerX, y: centerY - r },
          type: "bezier",
        }
      case "NE":
        return {
          start: { x: centerX, y: centerY - r },
          cp1: { x: centerX + r * k, y: centerY - r },
          cp2: { x: centerX + r, y: centerY - r * k },
          end: { x: centerX + r, y: centerY },
          type: "bezier",
        }
    }
    return null
  }

  // Find connected components
  findComponents() {
    const visited = new Set()
    const components = []

    for (const pointStr of this.points) {
      if (visited.has(pointStr)) continue

      const component = []
      const stack = [pointStr]

      while (stack.length > 0) {
        const current = stack.pop()
        if (visited.has(current)) continue

        visited.add(current)
        const [x, y] = current.split(",").map(Number)
        component.push({ x, y })

        ;[
          [x, y - 1],
          [x + 1, y],
          [x, y + 1],
          [x - 1, y],
        ].forEach(([nx, ny]) => {
          const neighbor = `${nx},${ny}`
          if (this.points.has(neighbor) && !visited.has(neighbor)) {
            stack.push(neighbor)
          }
        })
      }

      components.push(component)
    }

    return components
  }

  // Connect segments into continuous paths using spatial proximity
  connectSegmentsIntoPath(segments) {
    if (segments.length === 0) return ""
    if (segments.length === 1) {
      const s = segments[0]
      return `M ${s.start.x} ${s.start.y} C ${s.cp1.x} ${s.cp1.y} ${s.cp2.x} ${s.cp2.y} ${s.end.x} ${s.end.y}`
    }

    // Sort segments by angle from component center
    const centerX =
      (segments.reduce((sum, s) => sum + s.sourcePoint.x, 0) /
        segments.length) *
      this.gridSize
    const centerY =
      (segments.reduce((sum, s) => sum + s.sourcePoint.y, 0) /
        segments.length) *
      this.gridSize

    segments.forEach((segment) => {
      const midX = (segment.start.x + segment.end.x) / 2
      const midY = (segment.start.y + segment.end.y) / 2
      segment.angle = Math.atan2(midY - centerY, midX - centerX)
    })

    segments.sort((a, b) => a.angle - b.angle)

    // Build continuous path
    const pathCommands = []
    pathCommands.push(`M ${segments[0].start.x} ${segments[0].start.y}`)

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      // Add the curve
      pathCommands.push(
        `C ${segment.cp1.x} ${segment.cp1.y} ${segment.cp2.x} ${segment.cp2.y} ${segment.end.x} ${segment.end.y}`,
      )

      // Connect to next segment
      if (i < segments.length - 1) {
        const nextSegment = segments[i + 1]

        // Check if this should be a curved connection (diagonal bridge)
        const shouldUseCurve = this.shouldConnectWithCurve(segment, nextSegment)

        if (shouldUseCurve) {
          const bridgeCurve = this.generateBridgeCurve(
            segment.end,
            nextSegment.start,
          )
          pathCommands.push(
            `C ${bridgeCurve.cp1.x} ${bridgeCurve.cp1.y} ${bridgeCurve.cp2.x} ${bridgeCurve.cp2.y} ${nextSegment.start.x} ${nextSegment.start.y}`,
          )
        } else {
          pathCommands.push(`L ${nextSegment.start.x} ${nextSegment.start.y}`)
        }
      }
    }

    // Close the path by connecting back to start
    pathCommands.push(`L ${segments[0].start.x} ${segments[0].start.y}`)
    pathCommands.push("Z")

    return pathCommands.join(" ")
  }

  // Check if two segments should connect with a curve (diagonal bridge)
  shouldConnectWithCurve(segment1, segment2) {
    // Check if the gap between segments is diagonal (not aligned horizontally or vertically)
    const dx = Math.abs(segment2.start.x - segment1.end.x)
    const dy = Math.abs(segment2.start.y - segment1.end.y)

    // If both dx and dy are significant (not aligned), it's likely a diagonal connection
    const threshold = this.r * 0.5 // Half the radius
    return dx > threshold && dy > threshold
  }

  // Generate a bridge curve between two points following blob spec
  generateBridgeCurve(point1, point2) {
    // For inward/diagonal bridge curves, use mathematically derived ratio
    const bridgeK = this.k * 0.76039783 // Bridge curves need tighter control for smooth transitions

    // For diagonal bridges, control points should maintain the blob aesthetic
    const cp1 = {
      x: point1.x,
      y: point1.y + (point2.y - point1.y) * bridgeK,
    }
    const cp2 = {
      x: point1.x + (point2.x - point1.x) * bridgeK,
      y: point2.y,
    }

    return { cp1, cp2 }
  }

  // Main generation method
  generateCleanPaths() {
    const components = this.findComponents()
    const allSegments = this.generateAllBoundarySegments()

    // Group segments by component
    const segmentsByComponent = components.map((component, index) => {
      const componentPointSet = new Set(component.map((p) => `${p.x},${p.y}`))
      const componentSegments = allSegments.filter((segment) =>
        componentPointSet.has(
          `${segment.sourcePoint.x},${segment.sourcePoint.y}`,
        ),
      )
      return componentSegments
    })

    console.log("=== COMPONENT ANALYSIS ===")
    components.forEach((component, index) => {
      console.log(`\nComponent ${index + 1}: ${component.length} points`)
      console.log(
        `Points: ${component.map((p) => `(${p.x},${p.y})`).join(", ")}`,
      )
      console.log(`Boundary segments: ${segmentsByComponent[index].length}`)
    })

    // Generate clean paths
    const cleanPaths = []
    segmentsByComponent.forEach((segments, index) => {
      if (segments.length > 0) {
        const path = this.connectSegmentsIntoPath(segments)
        cleanPaths.push({
          component: index + 1,
          segmentCount: segments.length,
          path: path,
        })
      }
    })

    return cleanPaths
  }
}

// Test with your point set
const points = [
  "6,2",
  "8,2",
  "9,2",
  "6,4",
  "6,5",
  "8,4",
  "8,5",
  "9,4",
  "10,6",
  "11,4",
  "12,4",
  "12,5",
  "8,7",
  "8,8",
  "9,8",
  "11,8",
  "12,8",
  "12,7",
  "9,5",
]

console.log("Generating final clean blob paths...\n")

const generator = new FinalBlobPathGenerator(points, 20, 2)
const cleanPaths = generator.generateCleanPaths()

console.log("\n=== FINAL CLEAN CONTINUOUS PATHS ===\n")
cleanPaths.forEach(({ component, segmentCount, path }) => {
  console.log(`Component ${component} (${segmentCount} boundary segments):`)
  console.log(
    `<path d="${path}" fill="rgba(100,100,255,0.2)" stroke="blue" stroke-width="2" />\n`,
  )
})

// Generate final SVG
console.log("=== FINAL SVG FOR LASER CUTTING ===\n")
const pathElements = cleanPaths
  .map(
    ({ path }) =>
      `  <path d="${path}" fill="none" stroke="red" stroke-width="0.5" />`,
  )
  .join("\n")

const finalSVG = `<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
  <!-- Clean blob boundary paths for laser cutting -->
${pathElements}
</svg>`

console.log(finalSVG)

// Also save individual path data for programmatic use
console.log("\n=== PATH DATA FOR PROGRAMMATIC USE ===\n")
cleanPaths.forEach(({ component, path }, index) => {
  console.log(`const path${component} = "${path}";`)
})
