/**
 * DXF export for export-rect tool (separate mode).
 *
 * Mirrors the separate-mode logic of exportRectsSvg.ts but returns an array
 * of { filename, content } descriptors rather than triggering downloads
 * directly. The caller (exportZip.ts) bundles these into a zip archive.
 */

import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import { convertLayerToGridLayer } from "@/lib/export/svgUtils"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { generateLayerDxf } from "@/lib/blob-engine/renderers/DxfRenderer"

export interface ExportFile {
  filename: string
  content: string
}

/**
 * Build DXF file descriptors for all (rect × layer) combinations.
 * One DXF file per combination; cutouts rendered as LWPOLYLINE circles.
 */
export function buildDxfFiles(
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
      const engine = new BlobEngine({ enableCaching: false })
      const geometry = engine.generateLayerGeometry(gridLayer, gridSize, borderWidth)

      if (geometry.primitives.length === 0) return

      const layerName = `layer-${layer.id}`
      const dxf = generateLayerDxf(geometry, gridLayer, mmPerUnit, layerName)
      if (!dxf) return

      const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`
      const baseName = `${drawingName || "gridpaint"} - ${rectLabel} - layer-${layer.id}`
      // One file per combo; quantity is noted in the SVG filename but DXF is
      // a single cut path (the manufacturer cuts it rect.quantity times).
      files.push({
        filename: `${baseName}.dxf`,
        content: dxf,
      })
    })
  })

  return files
}
