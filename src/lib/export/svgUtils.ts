/**
 * Centralized SVG utilities for consistent rendering across all use cases
 * - Util routes (/layer, /grids/:drawingId/layers/:layerIndex)
 * - Export functionality (download button)
 *
 * Ensures consistent rendering with:
 * - Black stroke (0.02 width), transparent fill
 * - Full viewport from min/max bounds (no transforms)
 * - Same render logic regardless of source
 */

import type { Layer } from "@/stores/drawingStores"
import type { GridLayer } from "@/lib/blob-engine/types"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"

export interface SvgRenderOptions {
  strokeColor?: string
  strokeWidth?: number
  fillColor?: string
  opacity?: number
}

export interface LayerPoint {
  x: number
  y: number
}

/**
 * Default SVG styling for consistent rendering across all use cases
 */
export const DEFAULT_SVG_STYLE: SvgRenderOptions = {
  strokeColor: "#000",
  strokeWidth: 0.02,
  fillColor: "transparent",
  opacity: 1,
}

/**
 * Convert points from various formats to GridLayer format
 */
export function pointsToGridLayer(
  points: Set<string> | LayerPoint[],
  layerId: number = 1,
): GridLayer {
  let pointsSet: Set<string>

  if (Array.isArray(points)) {
    pointsSet = new Set(points.map((p) => `${p.x},${p.y}`))
  } else {
    pointsSet = points
  }

  return {
    id: layerId,
    points: pointsSet,
    isVisible: true,
    renderStyle: "default",
  }
}

/**
 * Calculate bounding box for multiple layers
 */
export function calculateLayersBounds(layers: GridLayer[]): {
  min: { x: number; y: number }
  max: { x: number; y: number }
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const layer of layers) {
    for (const pointStr of layer.points) {
      const [x, y] = pointStr.split(",").map(Number)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  // If no points, return default bounds
  if (minX === Infinity) {
    return { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/**
 * Generate SVG content for a single layer
 */
export function generateLayerSvgContent(
  layer: GridLayer,
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
): string {
  if (layer.points.size === 0) {
    return ""
  }

  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, gridSize, borderWidth)

  if (geometry.primitives.length === 0) {
    return ""
  }

  const renderer = new SvgPathRenderer(false)
  return renderer.renderLayer(
    geometry,
    {
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth,
      fillColor: style.fillColor,
      opacity: style.opacity,
    },
    {
      zoom: 1,
      panOffset: { x: 0, y: 0 },
      viewportWidth: 100,
      viewportHeight: 100,
    },
  )
}

/**
 * Generate complete SVG document for a single layer
 */
export function generateSingleLayerSvg(
  points: Set<string> | LayerPoint[],
  gridSize: number = 50,
  borderWidth: number = 2,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
  addMargin: boolean = false,
): string {
  const layer = pointsToGridLayer(points, 1)

  if (layer.points.size === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
</svg>`
  }

  // Generate the content first to get the actual geometry bounds
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, gridSize, borderWidth)

  if (geometry.primitives.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
</svg>`
  }

  // Use the actual bounding box from the geometry (in subgrid coordinates)
  // Add -1/+1 padding to min/max for buffer
  const { min, max } = geometry.boundingBox
  const paddedMinX = min.x - 1
  const paddedMinY = min.y - 1
  const paddedMaxX = max.x + 1
  const paddedMaxY = max.y + 1

  const width = paddedMaxX - paddedMinX
  const height = paddedMaxY - paddedMinY

  let viewX = paddedMinX
  let viewY = paddedMinY
  let viewW = width
  let viewH = height

  // Add 20% margin if requested (for util routes)
  if (addMargin) {
    const marginX = width * 0.2
    const marginY = height * 0.2
    viewX -= marginX / 2
    viewY -= marginY / 2
    viewW += marginX
    viewH += marginY
  }

  const content = generateLayerSvgContent(layer, gridSize, borderWidth, style)

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewW} ${viewH}">
${content}
</svg>`

  // For util routes, wrap in a centered div
  if (addMargin) {
    return `<div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5;">
  <div style="width: 100%; height: 100%; max-width: 90vw; max-height: 90vh;">
    ${svgContent}
  </div>
</div>`
  }

  return svgContent
}

/**
 * Generate complete SVG document for multiple layers
 */
export function generateMultiLayerSvg(
  layers: GridLayer[],
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
  addMargin: boolean = false,
): string {
  const visibleLayers = layers.filter(
    (layer) => layer.isVisible && layer.points.size > 0,
  )

  if (visibleLayers.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
</svg>`
  }

  // Generate all layer geometries to get the combined bounding box
  const engine = new BlobEngine({ enableCaching: false })
  const geometries = visibleLayers
    .map((layer) => engine.generateLayerGeometry(layer, gridSize, borderWidth))
    .filter((geo) => geo.primitives.length > 0)

  if (geometries.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
</svg>`
  }

  // Calculate combined bounding box from all geometries (in subgrid coordinates)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  for (const geo of geometries) {
    minX = Math.min(minX, geo.boundingBox.min.x)
    minY = Math.min(minY, geo.boundingBox.min.y)
    maxX = Math.max(maxX, geo.boundingBox.max.x)
    maxY = Math.max(maxY, geo.boundingBox.max.y)
  }

  // Add -1/+1 padding to min/max for buffer
  const paddedMinX = minX - 1
  const paddedMinY = minY - 1
  const paddedMaxX = maxX + 1
  const paddedMaxY = maxY + 1

  const width = paddedMaxX - paddedMinX
  const height = paddedMaxY - paddedMinY

  let viewX = paddedMinX
  let viewY = paddedMinY
  let viewW = width
  let viewH = height

  // Add 20% margin if requested
  if (addMargin) {
    const marginX = width * 0.2
    const marginY = height * 0.2
    viewX -= marginX / 2
    viewY -= marginY / 2
    viewW += marginX
    viewH += marginY
  }

  const layerContents = visibleLayers
    .map((layer) =>
      generateLayerSvgContent(layer, gridSize, borderWidth, style),
    )
    .filter(Boolean)
    .join("\n")

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewW} ${viewH}">
${layerContents}
</svg>`

  // For util routes, wrap in a centered div
  if (addMargin) {
    return `<div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5;">
  <div style="width: 100%; height: 100%; max-width: 90vw; max-height: 90vh;">
    ${svgContent}
  </div>
</div>`
  }

  return svgContent
}

/**
 * Convert Layer[] format (from drawingStores) to GridLayer[] format
 */
export function convertLayersToGridLayers(layers: Layer[]): GridLayer[] {
  return layers.map((layer) => ({
    id: layer.id,
    points: new Set(layer.points),
    isVisible: layer.isVisible,
    renderStyle: layer.renderStyle || "default",
  }))
}

/**
 * Generate SVG for export functionality (multiple layers as separate files)
 */
export function generateLayerSvgsForExport(
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
): { layerId: number; svg: string; filename: string }[] {
  const visibleLayers = layers.filter(
    (layer) => layer.isVisible && layer.points.size > 0,
  )

  return visibleLayers.map((layer) => {
    const gridLayer = pointsToGridLayer(layer.points, layer.id)
    const svg = generateSingleLayerSvg(
      layer.points,
      gridSize,
      borderWidth,
      style,
    )

    return {
      layerId: layer.id,
      svg,
      filename: `layer-${layer.id}.svg`,
    }
  })
}
