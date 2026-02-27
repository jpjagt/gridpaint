/**
 * Zip export: bundles SVG and DXF files into a single .zip download.
 *
 * Structure:
 *   <drawingName>/
 *     svgs/   ← one SVG per (rect × layer) combo
 *     dxfs/   ← one DXF per (rect × layer) combo
 */

import { zipSync, strToU8 } from "fflate"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { buildSvgFiles } from "@/lib/export/exportRectsSvg"
import { buildDxfFiles } from "@/lib/export/exportRectsDxf"

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export function exportSeparateZip(
  exportRects: ExportRect[],
  layers: Layer[],
  canvasView: CanvasViewState,
  drawingName: string,
): void {
  if (exportRects.length === 0) return

  const name = drawingName || "gridpaint"
  const { gridSize, borderWidth, mmPerUnit } = canvasView

  const svgFiles = buildSvgFiles(
    exportRects,
    layers,
    gridSize,
    borderWidth,
    name,
    mmPerUnit,
  )

  const dxfFiles = buildDxfFiles(
    exportRects,
    layers,
    gridSize,
    borderWidth,
    name,
    mmPerUnit,
  )

  const zipEntries: Record<string, Uint8Array> = {}

  for (const { filename, content } of svgFiles) {
    zipEntries[`svgs/${filename}`] = strToU8(content)
  }

  for (const { filename, content } of dxfFiles) {
    zipEntries[`dxfs/${filename}`] = strToU8(content)
  }

  const zipped = zipSync(zipEntries)
  const blob = new Blob([zipped], { type: "application/zip" })
  downloadBlob(blob, `${name}-export.zip`)
}
