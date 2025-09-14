/**
 * Export utilities for gridpaint drawings
 * Handles JSON and SVG export functionality
 */

import type { DrawingDocument, LayerData } from "@/lib/storage/types"
import type { Layer } from "@/stores/drawingStores"
import { magicNr } from "@/lib/constants"
import { generateLayerSvgsForExport, DEFAULT_SVG_STYLE } from "./svgUtils"

/**
 * Convert Set<string> points to Array<string> for JSON serialization
 */
function convertPointsForExport(layers: Layer[]): LayerData[] {
  return layers.map((layer) => ({
    id: layer.id,
    points: Array.from(layer.points) as any, // Will be serialized as array
    isVisible: layer.isVisible,
    renderStyle: layer.renderStyle,
  }))
}

/**
 * Export drawing data as JSON
 */
export function exportDrawingAsJSON(drawingDoc: DrawingDocument): void {
  // Convert points Sets to arrays for JSON serialization
  const exportDocument = {
    ...drawingDoc,
    layers: convertPointsForExport(drawingDoc.layers),
  }

  const jsonString = JSON.stringify(exportDocument, null, 2)
  const blob = new Blob([jsonString], { type: "application/json" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.download = `${drawingDoc.name || "gridpaint"}.json`
  link.href = url
  link.click()

  URL.revokeObjectURL(url)
}

/**
 * Find connected components (islands) in a set of points
 */
function findConnectedComponents(points: Set<string>): string[][] {
  const visited = new Set<string>()
  const components: string[][] = []

  for (const point of points) {
    if (visited.has(point)) continue

    const component: string[] = []
    const queue = [point]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue

      visited.add(current)
      component.push(current)

      const [x, y] = current.split(",").map(Number)

      // Check 8-connected neighbors
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue
          const neighbor = `${x + dx},${y + dy}`
          if (points.has(neighbor) && !visited.has(neighbor)) {
            queue.push(neighbor)
          }
        }
      }
    }

    if (component.length > 0) {
      components.push(component)
    }
  }

  return components
}

/**
 * Check neighbors for a point within a set of points (mimics RasterPoint logic)
 */
function getNeighbors(
  x: number,
  y: number,
  pointsSet: Set<string>,
): boolean[][] {
  const neighbors: boolean[][] = []
  for (let i = 0; i < 3; i++) {
    neighbors[i] = [false, false, false]
  }

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      const key = `${nx},${ny}`
      neighbors[dx + 1][dy + 1] = pointsSet.has(key)
    }
  }

  return neighbors
}

/**
 * Apply rotation transformation to a point around center
 */
function rotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angle: number,
): { x: number; y: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = x - centerX
  const dy = y - centerY

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  }
}

/**
 * Generate SVG path for Element0 (rectangular extension)
 */
function generateElement0Path(
  centerX: number,
  centerY: number,
  elementSize: number,
  rotation: number,
): string {
  // Element0 draws from center to positive quadrant
  const pixelSize = Math.ceil(elementSize) + 0.5

  if (rotation === 0) {
    // DOWN RIGHT: from center to +x,+y
    return `M ${centerX - 0.25} ${centerY - 0.25} h ${pixelSize} v ${pixelSize} h -${pixelSize} z`
  } else {
    // Apply rotation - generate the 4 corners and rotate them
    const corners = [
      { x: -0.25, y: -0.25 },
      { x: pixelSize - 0.25, y: -0.25 },
      { x: pixelSize - 0.25, y: pixelSize - 0.25 },
      { x: -0.25, y: pixelSize - 0.25 },
    ]

    const rotatedCorners = corners.map((corner) =>
      rotatePoint(corner.x, corner.y, 0, 0, rotation),
    )

    const first = rotatedCorners[0]
    let path = `M ${centerX + first.x} ${centerY + first.y}`

    for (let i = 1; i < rotatedCorners.length; i++) {
      const corner = rotatedCorners[i]
      path += ` L ${centerX + corner.x} ${centerY + corner.y}`
    }

    return path + " z"
  }
}

/**
 * Generate SVG path for Element1 (curved corner)
 */
function generateElement1Path(
  centerX: number,
  centerY: number,
  elementSize: number,
  magicNr: number,
  rotation: number,
): string {
  // Base path for 0 degrees (DOWN RIGHT quadrant)
  const basePoints = [
    { x: 0, y: 0 }, // center
    { x: elementSize, y: 0 }, // right edge
    { x: elementSize, y: elementSize * magicNr }, // control point 1
    { x: elementSize * magicNr, y: elementSize }, // control point 2
    { x: 0, y: elementSize }, // bottom edge
  ]

  // Apply rotation to all points
  const rotatedPoints = basePoints.map((point) =>
    rotatePoint(point.x, point.y, 0, 0, rotation),
  )

  const [center, edge1, cp1, cp2, edge2] = rotatedPoints

  return `M ${centerX + center.x} ${centerY + center.y}
          L ${centerX + edge1.x} ${centerY + edge1.y}
          C ${centerX + cp1.x} ${centerY + cp1.y}
            ${centerX + cp2.x} ${centerY + cp2.y}
            ${centerX + edge2.x} ${centerY + edge2.y} z`
}

/**
 * Generate SVG path for Element2 (diagonal bridge)
 */
function generateElement2Path(
  centerX: number,
  centerY: number,
  elementSize: number,
  magicNr: number,
  rotation: number,
): string {
  // Base path for 0 degrees (connecting right and bottom)
  const basePoints = [
    { x: elementSize, y: 0 }, // right edge
    { x: elementSize, y: elementSize * magicNr }, // control point 1
    { x: elementSize * magicNr, y: elementSize }, // control point 2
    { x: 0, y: elementSize }, // bottom edge
    { x: elementSize, y: elementSize }, // corner
  ]

  // Apply rotation to all points
  const rotatedPoints = basePoints.map((point) =>
    rotatePoint(point.x, point.y, 0, 0, rotation),
  )

  const [edge1, cp1, cp2, edge2, corner] = rotatedPoints

  return `M ${centerX + edge1.x} ${centerY + edge1.y}
          C ${centerX + cp1.x} ${centerY + cp1.y}
            ${centerX + cp2.x} ${centerY + cp2.y}
            ${centerX + edge2.x} ${centerY + edge2.y}
          L ${centerX + corner.x} ${centerY + corner.y} z`
}

/**
 * Generate SVG path for a single blob element (mimics canvas drawing logic)
 */
function generateBlobElementPath(
  x: number,
  y: number,
  elementSize: number,
  neighbors: boolean[][],
  gridSize: number,
): string {
  const centerX = x * gridSize + gridSize / 2
  const centerY = y * gridSize + gridSize / 2

  const pathParts: string[] = []
  const isCenter = neighbors[1][1]

  if (isCenter) {
    // Generate 4 quadrants with proper neighbor checking
    const quadrants = [
      {
        // DOWN RIGHT quadrant (0 degrees)
        hasNeighbors: neighbors[2][1] || neighbors[2][2] || neighbors[1][2],
        rotation: 0,
      },
      {
        // DOWN LEFT quadrant (90 degrees)
        hasNeighbors: neighbors[0][1] || neighbors[0][2] || neighbors[1][2],
        rotation: Math.PI / 2,
      },
      {
        // UP LEFT quadrant (180 degrees)
        hasNeighbors: neighbors[0][1] || neighbors[0][0] || neighbors[1][0],
        rotation: Math.PI,
      },
      {
        // UP RIGHT quadrant (270 degrees)
        hasNeighbors: neighbors[1][0] || neighbors[2][0] || neighbors[2][1],
        rotation: (3 * Math.PI) / 2,
      },
    ]

    for (const quadrant of quadrants) {
      if (quadrant.hasNeighbors) {
        // Element0: rectangular extension
        pathParts.push(
          generateElement0Path(
            centerX,
            centerY,
            elementSize,
            quadrant.rotation,
          ),
        )
      } else {
        // Element1: curved corner
        pathParts.push(
          generateElement1Path(
            centerX,
            centerY,
            elementSize,
            magicNr,
            quadrant.rotation,
          ),
        )
      }
    }
  } else {
    // Diagonal bridges (Element2 logic)
    const bridges = [
      {
        condition: neighbors[2][1] && neighbors[1][2],
        rotation: 0,
      },
      {
        condition: neighbors[1][2] && neighbors[0][1],
        rotation: Math.PI / 2,
      },
      {
        condition: neighbors[0][1] && neighbors[1][0],
        rotation: Math.PI,
      },
      {
        condition: neighbors[1][0] && neighbors[2][1],
        rotation: (3 * Math.PI) / 2,
      },
    ]

    for (const bridge of bridges) {
      if (bridge.condition) {
        // Element2: bridge curve
        pathParts.push(
          generateElement2Path(
            centerX,
            centerY,
            elementSize,
            magicNr,
            bridge.rotation,
          ),
        )
      }
    }
  }

  return pathParts.join(" ")
}

/**
 * Convert a connected component to an optimized SVG path using blob logic
 */
function componentToSVGPath(
  component: string[],
  gridSize: number,
  borderWidth: number = 0,
): string {
  if (component.length === 0) return ""

  const pointsSet = new Set(component)
  const elementSize = gridSize / 2 + borderWidth
  const pathParts: string[] = []

  // Find all points that need rendering (filled + neighbors for bridges)
  const pointsToRender = new Set<string>()

  // Add all filled points
  for (const pointStr of component) {
    pointsToRender.add(pointStr)

    // Add neighbors for bridge rendering
    const [x, y] = pointStr.split(",").map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        pointsToRender.add(`${x + dx},${y + dy}`)
      }
    }
  }

  // Generate blob elements for each point that needs rendering
  for (const pointStr of pointsToRender) {
    const [x, y] = pointStr.split(",").map(Number)
    const neighbors = getNeighbors(x, y, pointsSet)

    // Check if this point should render anything (same logic as canvas)
    const isActive = pointsSet.has(pointStr)
    const hasActiveNeighbors = neighbors.some((row) => row.some((cell) => cell))

    if (isActive || hasActiveNeighbors) {
      const elementPath = generateBlobElementPath(
        x,
        y,
        elementSize,
        neighbors,
        gridSize,
      )
      if (elementPath) {
        pathParts.push(elementPath)
      }
    }
  }

  return pathParts.join(" ")
}

/**
 * Export a single layer as SVG using centralized utilities
 */
export function exportLayerAsSVG(
  layer: Layer,
  gridSize: number,
  borderWidth: number,
  name: string,
): void {
  if (layer.points.size === 0) {
    console.warn(`Layer ${layer.id} has no points to export`)
    return
  }

  const layerSvgs = generateLayerSvgsForExport(
    [layer],
    gridSize,
    borderWidth,
    DEFAULT_SVG_STYLE
  )

  if (layerSvgs.length === 0) {
    console.warn(`Layer ${layer.id} produced no SVG content`)
    return
  }

  const { svg } = layerSvgs[0]

  const blob = new Blob([svg], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.download = `${name || "gridpaint"}-layer-${layer.id}.svg`
  link.href = url
  link.click()

  URL.revokeObjectURL(url)
}

/**
 * Export all visible layers as SVG files using centralized utilities
 */
export function exportAllLayersAsSVG(
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  name: string,
): void {
  const layerSvgs = generateLayerSvgsForExport(
    layers,
    gridSize,
    borderWidth,
    DEFAULT_SVG_STYLE
  )

  if (layerSvgs.length === 0) {
    console.warn("No visible layers with points to export")
    return
  }

  // Export each layer separately with a small delay to prevent browser issues
  layerSvgs.forEach(({ svg, layerId }, index) => {
    setTimeout(() => {
      const blob = new Blob([svg], { type: "image/svg+xml" })
      const url = URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.download = `${name || "gridpaint"}-layer-${layerId}.svg`
      link.href = url
      link.click()

      URL.revokeObjectURL(url)
    }, index * 100)
  })
}
