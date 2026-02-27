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
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { ExportFile } from "@/lib/export/exportRectsDxf"

export type ExportMode = "separate" | "combined"

interface ExportItem {
  rectIndex: number
  layerId: number
  quantity: number
  /** Width of the tile in subgrid units (bbox width + padding) */
  svgWidth: number
  /** Height of the tile in subgrid units (bbox height + padding) */
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
 */
export function buildSvgFiles(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
): ExportFile[] {
  const visibleLayers = layers.filter((l) => l.isVisible)
  const files: ExportFile[] = []

  exportRects.forEach((rect, rectIdx) => {
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)
    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const svg = generateSingleLayerSvg(
        gridLayer,
        gridSize,
        borderWidth,
        DEFAULT_SVG_STYLE,
        false,
        mmPerUnit,
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
      const clippedLayers = clipLayersToSelection(visibleLayers, rect)
      clippedLayers.forEach((layer) => {
        const gridLayer = convertLayerToGridLayer(layer)
        const svg = generateSingleLayerSvg(
          gridLayer,
          gridSize,
          borderWidth,
          DEFAULT_SVG_STYLE,
          false,
          mmPerUnit,
        )

        const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`
        const filename = `${drawingName || "gridpaint"} - ${rectLabel} - layer-${layer.id}.x${rect.quantity}.svg`
        setTimeout(() => downloadSvg(svg, filename), downloadIndex * 100)
        downloadIndex++
      })
    })
    return
  }

  // Combined mode — build a single SVG with items laid out in rows
  // Gap constants in subgrid units (gridSize subgrid = 2 subgrid units per grid cell)
  const GAP_BETWEEN_COPIES = 2 // subgrid units between copies in a row
  const GAP_BETWEEN_ROWS = 4 // subgrid units between rows

  const items: ExportItem[] = []

  exportRects.forEach((rect, rectIdx) => {
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)
    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const bbox = computeLayerSvgDimensions(layer, gridSize, borderWidth)
      if (!bbox) return

      const padding = 1 // 1 subgrid unit padding on each side
      const svgWidth = bbox.maxX - bbox.minX + 2 * padding
      const svgHeight = bbox.maxY - bbox.minY + 2 * padding

      const content = generateLayerSvgContent(
        gridLayer,
        gridSize,
        borderWidth,
        DEFAULT_SVG_STYLE,
        mmPerUnit,
      )

      // Normalising offsets: shift path coordinates so the tile starts at (0,0)
      const normTx = -bbox.minX + padding
      const normTy = -bbox.minY + padding

      items.push({
        rectIndex: rectIdx,
        layerId: layer.id,
        quantity: rect.quantity,
        svgWidth,
        svgHeight,
        normTx,
        normTy,
        content,
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
    // Combined translate: layout position + normalising shift so path coords become positive
    const tx = x + item.normTx
    const ty = y + item.normTy
    return `  <g id="${groupId}" transform="translate(${tx} ${ty})">\n${item.content}\n  </g>`
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
