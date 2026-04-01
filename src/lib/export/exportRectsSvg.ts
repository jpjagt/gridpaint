/**
 * SVG export for export-rect tool.
 *
 * Two modes:
 *  - "separate": one SVG file per (rect × layer) combo, each quantity copy
 *    gets its own file (staggered download, same as existing export).
 *  - "combined": single SVG with all items laid out in rows.
 *    Layout: one row per (rect × layer) combo, each row contains `quantity`
 *    copies side-by-side with a 2mm gap. Rows stacked vertically with a 4mm
 *    gap. Each combo wrapped in a labelled <g>.
 */

import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import {
  generateSingleLayerSvg,
  generateLayerSvgContent,
  convertLayerToGridLayer,
  DEFAULT_SVG_STYLE,
} from "@/lib/export/svgUtils"
import type { SvgRenderOptions } from "@/lib/export/svgUtils"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { ExportFile } from "@/lib/export/exportRectsDxf"
import {
  packShapes,
  generateHolderOutline,
  shiftLayer,
  getLayerBoundingBox,
  type ShapeData,
} from "@/lib/export/nestedLayout"
import { filterOuterPaths } from "@/lib/export/pathUtils"

export type { SvgRenderOptions as SvgPreviewOptions }
export type ExportMode = "separate" | "combined" | "holder"

interface ExportItem {
  rectIndex: number
  layerId: number
  quantity: number
  /** Width of the tile in subgrid units (bbox width + padding), after scaling */
  svgWidth: number
  /** Height of the tile in subgrid units (bbox height + padding), after scaling */
  svgHeight: number
  /**
   * Translation to apply to each copy so that the raw path coordinates
   * (which are in global grid space) are shifted to start at (0,0) within
   * the tile.  tx = -bbox.minX + padding, ty = -bbox.minY + padding.
   */
  normTx: number
  normTy: number
  /** The <g>...</g> content string for embedding in a combined SVG */
  content: string
  /** Scale factor for custom mmPerUnit (customMmPerUnit / globalMmPerUnit) */
  scale: number
}

function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Compute SVG dimensions for a clipped layer (in subgrid units = gridSize/2 pixels).
 * Returns null if the layer has no geometry.
 */
function computeLayerSvgDimensions(
  clippedLayer: Layer,
  gridSize: number,
  borderWidth: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const gridLayer = convertLayerToGridLayer(clippedLayer)
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(
    gridLayer,
    gridSize,
    borderWidth,
  )
  if (geometry.primitives.length === 0) return null
  const { min, max } = geometry.boundingBox
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }
}

/**
 * Build SVG file descriptors for all (rect × layer) combinations (separate mode).
 * Returns { filename, content }[] without triggering any downloads.
 * Pass `style` to override the default SVG render options (e.g. thinner stroke for previews).
 */
export function buildSvgFiles(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
  style: SvgRenderOptions = DEFAULT_SVG_STYLE,
): ExportFile[] {
  const visibleLayers = layers.filter((l) => l.isVisible)
  const files: ExportFile[] = []

  exportRects.forEach((rect, rectIdx) => {
    const effectiveMmPerUnit = rect.customMmPerUnit || mmPerUnit
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)
    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const svg = generateSingleLayerSvg(
        gridLayer,
        gridSize,
        borderWidth,
        style,
        false,
        effectiveMmPerUnit,
      )
      const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`
      const filename = `${drawingName || "gridpaint"} - ${rectLabel} - layer-${layer.id}.x${rect.quantity}.svg`
      files.push({ filename, content: svg })
    })
  })

  return files
}

export function exportExportRectsSvg(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
  mode: ExportMode,
): void {
  if (exportRects.length === 0) return

  const visibleLayers = layers.filter((l) => l.isVisible)

  if (mode === "separate") {
    let downloadIndex = 0
    exportRects.forEach((rect, rectIdx) => {
      const effectiveMmPerUnit = rect.customMmPerUnit || mmPerUnit
      const clippedLayers = clipLayersToSelection(visibleLayers, rect)
      clippedLayers.forEach((layer) => {
        const gridLayer = convertLayerToGridLayer(layer)
        const svg = generateSingleLayerSvg(
          gridLayer,
          gridSize,
          borderWidth,
          DEFAULT_SVG_STYLE,
          false,
          effectiveMmPerUnit,
        )

        const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`
        const filename = `${drawingName || "gridpaint"} - ${rectLabel} - layer-${layer.id}.x${rect.quantity}.svg`
        setTimeout(() => downloadSvg(svg, filename), downloadIndex * 100)
        downloadIndex++
      })
    })
    return
  }

  if (mode === "holder") {
    // Holder mode — pack shapes and generate holder with cutouts
    exportHolderSvg(
      exportRects,
      visibleLayers,
      gridSize,
      borderWidth,
      drawingName,
      mmPerUnit,
    )
    return
  }

  // Combined mode — build a single SVG with items laid out in rows
  // Gap constants in subgrid units (gridSize subgrid = 2 subgrid units per grid cell)
  const GAP_BETWEEN_COPIES = 2 // subgrid units between copies in a row
  const GAP_BETWEEN_ROWS = 4 // subgrid units between rows

  const items: ExportItem[] = []

  exportRects.forEach((rect, rectIdx) => {
    const effectiveMmPerUnit = rect.customMmPerUnit || mmPerUnit
    const scale = effectiveMmPerUnit / mmPerUnit
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)
    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const bbox = computeLayerSvgDimensions(layer, gridSize, borderWidth)
      if (!bbox) return

      const padding = 1 // 1 subgrid unit padding on each side
      const svgWidth = (bbox.maxX - bbox.minX + 2 * padding) * scale
      const svgHeight = (bbox.maxY - bbox.minY + 2 * padding) * scale

      const content = generateLayerSvgContent(
        gridLayer,
        gridSize,
        borderWidth,
        DEFAULT_SVG_STYLE,
        effectiveMmPerUnit,
      )

      // Normalising offsets: shift path coordinates so the tile starts at (0,0)
      const normTx = (-bbox.minX + padding) * scale
      const normTy = (-bbox.minY + padding) * scale

      items.push({
        rectIndex: rectIdx,
        layerId: layer.id,
        quantity: rect.quantity,
        svgWidth,
        svgHeight,
        normTx,
        normTy,
        content,
        scale,
      })
    })
  })

  if (items.length === 0) return

  // Layout: place rows vertically, copies horizontally
  let currentY = 0
  let totalWidth = 0
  let totalHeight = 0

  interface PlacedItem {
    item: ExportItem
    copyIndex: number
    x: number
    y: number
  }

  const placed: PlacedItem[] = []

  for (const item of items) {
    const rowHeight = item.svgHeight
    let currentX = 0

    for (let q = 0; q < item.quantity; q++) {
      placed.push({ item, copyIndex: q, x: currentX, y: currentY })
      currentX += item.svgWidth + GAP_BETWEEN_COPIES
    }

    totalWidth = Math.max(totalWidth, currentX - GAP_BETWEEN_COPIES)
    totalHeight = currentY + rowHeight
    currentY += rowHeight + GAP_BETWEEN_ROWS
  }

  // Physical dimensions in mm
  const physW = totalWidth * mmPerUnit
  const physH = totalHeight * mmPerUnit

  const groups = placed.map(({ item, copyIndex, x, y }) => {
    const groupId = `rect${item.rectIndex + 1}-layer${item.layerId}${item.quantity > 1 ? `-copy${copyIndex + 1}` : ""}`
    // Transform: layout position (x, y) + scale + normalising shift
    // The content is in subgrid units, scale it, then translate to normalize
    const unscaledNormTx = item.normTx / item.scale
    const unscaledNormTy = item.normTy / item.scale
    const transform = item.scale !== 1
      ? `translate(${x} ${y}) scale(${item.scale}) translate(${unscaledNormTx} ${unscaledNormTy})`
      : `translate(${x + item.normTx} ${y + item.normTy})`
    return `  <g id="${groupId}" transform="${transform}">\n${item.content}\n  </g>`
  })

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${physW}mm"
     height="${physH}mm"
     viewBox="0 0 ${totalWidth} ${totalHeight}">
${groups.join("\n")}
</svg>`

  downloadSvg(svg, `${drawingName || "gridpaint"}-export.svg`)
}

function exportHolderSvg(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
): void {
  const MARGIN = 2
  const OUTER_MARGIN = 5

  const shapeData: ShapeData[] = []

  exportRects.forEach((rect, rectIdx) => {
    const clippedLayers = clipLayersToSelection(layers, rect)

    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const svgBounds = computeLayerSvgDimensions(layer, gridSize, borderWidth)
      const gridBounds = getLayerBoundingBox(gridLayer)
      if (!svgBounds || !gridBounds) return

      const width = svgBounds.maxX - svgBounds.minX + 2
      const height = svgBounds.maxY - svgBounds.minY + 2

      for (let q = 0; q < rect.quantity; q++) {
        shapeData.push({
          id: `rect${rectIdx + 1}-layer${layer.id}-copy${q + 1}`,
          width,
          height,
          layerName: `rect${rectIdx + 1}-layer${layer.id}`,
          layer: gridLayer,
          offsetX: -gridBounds.minX,
          offsetY: -gridBounds.minY,
        })
      }
    })
  })

  if (shapeData.length === 0) return

  const packed = packShapes(shapeData, {
    margin: MARGIN,
    outerMargin: OUTER_MARGIN,
  })

  const outline = generateHolderOutline(
    packed.totalWidth,
    packed.totalHeight,
    OUTER_MARGIN,
  )

  const physW = packed.totalWidth * mmPerUnit
  const physH = packed.totalHeight * mmPerUnit

  const paths: string[] = [
    `<path d="${outline}" fill="none" stroke="#000" stroke-width="0.1"/>`,
  ]

  packed.items.forEach((item) => {
    const deltaX = item.x + item.offsetX
    const deltaY = item.y + item.offsetY

    const shiftedLayer = shiftLayer(item.layer, deltaX, deltaY)

    const content = generateLayerSvgContent(
      shiftedLayer,
      gridSize,
      borderWidth,
      {
        ...DEFAULT_SVG_STYLE,
        includeCutouts: false,
      },
      mmPerUnit,
    )

    const pathMatches = Array.from(content.matchAll(/<path[^>]+d="([^"]+)"/g)).map(m => m[1])
    const outerPaths = filterOuterPaths(pathMatches)

    for (const pathD of outerPaths) {
      paths.push(
        `<path d="${pathD}" fill="none" stroke="#000" stroke-width="0.1"/>`,
      )
    }
  })

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${physW}mm"
     height="${physH}mm"
     viewBox="0 0 ${packed.totalWidth} ${packed.totalHeight}">
${paths.join("\n")}
</svg>`

  downloadSvg(svg, `${drawingName || "gridpaint"}-holder.svg`)
}
