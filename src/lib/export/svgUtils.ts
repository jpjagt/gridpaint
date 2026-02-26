/**
 * Centralized SVG utilities for consistent rendering across all use cases
 * - Util routes (/grids/:drawingId/layers/:layerIndex)
 * - Export functionality (download button)
 *
 * Ensures consistent rendering with:
 * - Black stroke (0.02 width), transparent fill
 * - Full viewport from min/max bounds (no transforms)
 * - Same render logic regardless of source
 */

import type { Layer } from "@/stores/drawingStores"
import { getLayerPoints } from "@/stores/drawingStores"
import type { GridLayer } from "@/lib/blob-engine/types"
import { getGridLayerPoints } from "@/lib/blob-engine/types"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { SvgPathRendererDebugInfo } from "@/lib/blob-engine/renderers/SvgPathRenderer"

export type { SvgPathRendererDebugInfo as SvgRenderDebugInfo }

export interface SvgRenderOptions {
  strokeColor?: string
  strokeWidth?: number
  fillColor?: string
  opacity?: number
}

/**
 * Default SVG styling for consistent rendering across all use cases
 */
export const DEFAULT_SVG_STYLE: SvgRenderOptions = {
  strokeColor: "#000",
  strokeWidth: 0.5,
  fillColor: "transparent",
  opacity: 1,
}

/**
 * Create a simple GridLayer from a Set of point keys.
 * Use this only when you have raw points without group/modification data.
 */
export function pointsToGridLayer(
  points: Set<string>,
  layerId: number = 1,
): GridLayer {
  return {
    id: layerId,
    groups: [{ id: "default", points: points }],
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
    for (const pointStr of getGridLayerPoints(layer)) {
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
 * Generate SVG content for a single layer.
 * This is the core rendering function — it runs BlobEngine (which invokes
 * GroupMerger for multi-group layers / layers with pointModifications) and
 * then renders the resulting geometry via SvgPathRenderer (which handles
 * cutout paths).
 */
export function generateLayerSvgContent(
  layer: GridLayer,
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
  mmPerUnit: number = 1,
): string {
  if (getGridLayerPoints(layer).size === 0) {
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
    layer,
    mmPerUnit,
  )
}

/**
 * Like generateLayerSvgContent but also returns the renderer's debug info
 * (intermediate CurvePrimitive states). Pass debugMode=true to enable.
 */
export function generateLayerSvgContentWithDebug(
  layer: GridLayer,
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
): { content: string; debugInfo: SvgPathRendererDebugInfo | null } {
  if (getGridLayerPoints(layer).size === 0) {
    return { content: "", debugInfo: null }
  }

  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, gridSize, borderWidth)

  if (geometry.primitives.length === 0) {
    return { content: "", debugInfo: null }
  }

  const renderer = new SvgPathRenderer(true)
  const content = renderer.renderLayer(
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
    layer,
  )

  return { content, debugInfo: renderer.getLastDebugInfo() }
}

/**
 * Generate complete SVG document for a single layer.
 * Accepts a full GridLayer so that groups, pointModifications (cutouts,
 * quadrant overrides) are all preserved through the rendering pipeline.
 */
export function generateSingleLayerSvg(
  layer: GridLayer,
  gridSize: number = 50,
  borderWidth: number = 2,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
  addMargin: boolean = false,
  mmPerUnit: number = 1.0,
): string {
  if (getGridLayerPoints(layer).size === 0) {
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

  const content = generateLayerSvgContent(
    layer,
    gridSize,
    borderWidth,
    style,
    mmPerUnit,
  )

  // Calculate physical dimensions in mm
  const physicalWidth = viewW * mmPerUnit
  const physicalHeight = viewH * mmPerUnit

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${physicalWidth}mm"
     height="${physicalHeight}mm"
     viewBox="${viewX} ${viewY} ${viewW} ${viewH}">
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
  mmPerUnit: number = 1.0,
): string {
  const visibleLayers = layers.filter(
    (layer) => layer.isVisible && getGridLayerPoints(layer).size > 0,
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
      generateLayerSvgContent(layer, gridSize, borderWidth, style, mmPerUnit),
    )
    .filter(Boolean)
    .join("\n")

  // Calculate physical dimensions in mm
  const physicalWidth = viewW * mmPerUnit
  const physicalHeight = viewH * mmPerUnit

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${physicalWidth}mm"
     height="${physicalHeight}mm"
     viewBox="${viewX} ${viewY} ${viewW} ${viewH}">
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
 * Convert Layer[] format (from drawingStores) to GridLayer[] format.
 * Preserves groups, pointModifications, and all layer metadata.
 */
export function convertLayersToGridLayers(layers: Layer[]): GridLayer[] {
  return layers.map((layer) => ({
    id: layer.id,
    groups: layer.groups.map((g) => ({
      id: g.id,
      name: g.name,
      points: new Set(g.points),
    })),
    isVisible: layer.isVisible,
    renderStyle: layer.renderStyle || "default",
    pointModifications: layer.pointModifications,
  }))
}

/**
 * Convert a single Layer (from drawingStores) to GridLayer format.
 * Preserves groups, pointModifications, and all layer metadata.
 */
export function convertLayerToGridLayer(layer: Layer): GridLayer {
  return convertLayersToGridLayers([layer])[0]
}

/**
 * Generate SVG for export functionality (multiple layers as separate files).
 * Uses convertLayerToGridLayer to preserve groups and pointModifications.
 */
export function generateLayerSvgsForExport(
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
  mmPerUnit: number = 1.0,
): { layerId: number; svg: string; filename: string }[] {
  const visibleLayers = layers.filter(
    (layer) => layer.isVisible && getLayerPoints(layer).size > 0,
  )

  return visibleLayers.map((layer) => {
    const gridLayer = convertLayerToGridLayer(layer)
    const svg = generateSingleLayerSvg(
      gridLayer,
      gridSize,
      borderWidth,
      style,
      false, // addMargin
      mmPerUnit,
    )

    return {
      layerId: layer.id,
      svg,
      filename: `layer-${layer.id}.svg`,
    }
  })
}
