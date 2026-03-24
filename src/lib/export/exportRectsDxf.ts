/**
 * DXF export for export-rect tool (separate and combined modes).
 *
 * - buildDxfFiles: one DXF file per (rect × layer) combo (used by zip export).
 * - buildCombinedDxf: single DXF with all items laid out in rows, mirroring
 *   the combined-SVG layout logic from exportRectsSvg.ts.
 * - exportCombinedDxf: triggers a browser download of the combined DXF.
 */

import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import { convertLayerToGridLayer } from "@/lib/export/svgUtils"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import {
  generateLayerDxf,
  generateLayerDxfEntities,
  USE_LEGACY_POLYLINE,
} from "@/lib/blob-engine/renderers/DxfRenderer"

export interface ExportFile {
  filename: string
  content: string
}

// ---------------------------------------------------------------------------
// DXF header/footer helpers (duplicated minimally; DxfRenderer internals are
// not exported, so we build a thin wrapper here for the combined document).
// ---------------------------------------------------------------------------

function fmtMm(v: number): string {
  return (Math.round(v * 10000) / 10000).toString()
}

function buildCombinedDxfHeader(
  layerNames: string[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): string {
  const acadver = USE_LEGACY_POLYLINE ? "AC1009" : "AC1015"
  const pad = 1
  const layerDefs = layerNames
    .map((name) => `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS`)
    .join("\n")

  return `0
SECTION
2
HEADER
9
$ACADVER
1
${acadver}
9
$INSUNITS
70
4
9
$MEASUREMENT
70
1
9
$EXTMIN
10
${fmtMm(minX - pad)}
20
${fmtMm(minY - pad)}
30
0
9
$EXTMAX
10
${fmtMm(maxX + pad)}
20
${fmtMm(maxY + pad)}
30
0
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
${layerNames.length}
${layerDefs}
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES`
}

function buildCombinedDxfFooter(): string {
  return `0
ENDSEC
0
EOF`
}

// ---------------------------------------------------------------------------
// Separate-mode DXF build (for zip export)
// ---------------------------------------------------------------------------

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
    const effectiveMmPerUnit = rect.customMmPerUnit || mmPerUnit
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)
    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const engine = new BlobEngine({ enableCaching: false })
      const geometry = engine.generateLayerGeometry(gridLayer, gridSize, borderWidth)

      if (geometry.primitives.length === 0) return

      const layerName = `layer-${layer.id}`
      const dxf = generateLayerDxf(geometry, gridLayer, effectiveMmPerUnit, layerName)
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

// ---------------------------------------------------------------------------
// Combined-mode DXF build
// ---------------------------------------------------------------------------

/**
 * Build a single DXF string with all (rect × layer × quantity) items laid out
 * in rows, mirroring the combined-SVG layout from exportRectsSvg.ts.
 *
 * Layout (in mm):
 *  - One row per (rect × layer) combo.
 *  - Each row contains `quantity` copies side-by-side with GAP_BETWEEN_COPIES_MM gap.
 *  - Rows stacked vertically with GAP_BETWEEN_ROWS_MM gap.
 *  - 1-subgrid-unit padding around each item.
 *
 * DXF coordinates are absolute mm (no transforms); each item is translated to
 * its slot position using generateLayerDxfEntities() with an mm offset.
 */
export function buildCombinedDxf(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
): string {
  const visibleLayers = layers.filter((l) => l.isVisible)

  // Gap constants mirror exportRectsSvg.ts (in subgrid units → converted to mm)
  // 2 subgrid units * mmPerUnit = gap between copies; 4 * mmPerUnit = gap between rows.
  // We use the global mmPerUnit for gap sizing (same as SVG combined mode).
  const GAP_COPIES_MM = 2 * mmPerUnit
  const GAP_ROWS_MM = 4 * mmPerUnit
  const PADDING_MM = 1 * mmPerUnit // 1 subgrid unit padding on each side

  interface PlacedItem {
    geometry: ReturnType<BlobEngine["generateLayerGeometry"]>
    gridLayer: ReturnType<typeof convertLayerToGridLayer>
    effectiveMmPerUnit: number
    layerName: string
    /** Physical item width in mm (bbox + padding) */
    widthMm: number
    /** Physical item height in mm (bbox + padding) */
    heightMm: number
    /** X offset in mm where this copy's bbox-min should land */
    offsetXMm: number
    /** Y offset in mm where this copy's bbox-min should land (DXF Y-up: bottom of item) */
    offsetYMm: number
  }

  const placed: PlacedItem[] = []
  let currentYMm = 0
  let totalWidthMm = 0
  let totalHeightMm = 0

  exportRects.forEach((rect, rectIdx) => {
    const effectiveMmPerUnit = rect.customMmPerUnit || mmPerUnit
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)

    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const engine = new BlobEngine({ enableCaching: false })
      const geometry = engine.generateLayerGeometry(gridLayer, gridSize, borderWidth)
      if (geometry.primitives.length === 0) return

      const bboxWidthMm =
        (geometry.boundingBox.max.x - geometry.boundingBox.min.x) * effectiveMmPerUnit
      const bboxHeightMm =
        (geometry.boundingBox.max.y - geometry.boundingBox.min.y) * effectiveMmPerUnit

      const itemWidthMm = bboxWidthMm + 2 * PADDING_MM
      const itemHeightMm = bboxHeightMm + 2 * PADDING_MM

      const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`
      const layerName =
        rect.quantity > 1
          ? `rect${rectIdx + 1}-layer${layer.id}`
          : `${rectLabel}-layer${layer.id}`

      let currentXMm = 0
      for (let q = 0; q < rect.quantity; q++) {
        placed.push({
          geometry,
          gridLayer,
          effectiveMmPerUnit,
          layerName: rect.quantity > 1 ? `${layerName}-copy${q + 1}` : layerName,
          widthMm: itemWidthMm,
          heightMm: itemHeightMm,
          offsetXMm: currentXMm + PADDING_MM,
          // DXF Y-up: the item occupies [currentYMm, currentYMm + itemHeightMm].
          // The bbox-min (lowest Y in subgrid/screen space = top visually) maps
          // to the highest Y in DXF space. We pass the bottom-left of the slot
          // (currentYMm + PADDING_MM) as the DXF Y origin for this item.
          offsetYMm: currentYMm + PADDING_MM,
        })
        currentXMm += itemWidthMm + GAP_COPIES_MM
      }

      const rowWidth = currentXMm - GAP_COPIES_MM
      totalWidthMm = Math.max(totalWidthMm, rowWidth)
      totalHeightMm = currentYMm + itemHeightMm
      currentYMm += itemHeightMm + GAP_ROWS_MM
    })
  })

  if (placed.length === 0) return ""

  // Collect all entities and layer names
  const allEntities: string[] = []
  const allLayerNames = new Set<string>()

  for (const item of placed) {
    const result = generateLayerDxfEntities(
      item.geometry,
      item.gridLayer,
      item.effectiveMmPerUnit,
      item.layerName,
      item.offsetXMm,
      item.offsetYMm,
    )
    if (!result) continue
    for (const name of result.layerNames) allLayerNames.add(name)
    allEntities.push(...result.entities)
  }

  if (allEntities.length === 0) return ""

  const header = buildCombinedDxfHeader(
    [...allLayerNames],
    0,
    0,
    totalWidthMm,
    totalHeightMm,
  )

  return [header, allEntities.join("\n"), buildCombinedDxfFooter()].join("\n")
}

/**
 * Build and trigger a browser download of a combined DXF file.
 */
export function exportCombinedDxf(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  drawingName: string,
  mmPerUnit: number,
): void {
  if (exportRects.length === 0) return
  const dxf = buildCombinedDxf(
    exportRects,
    layers,
    gridSize,
    borderWidth,
    drawingName,
    mmPerUnit,
  )
  if (!dxf) return

  const blob = new Blob([dxf], { type: "application/dxf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = `${drawingName || "gridpaint"}-export.dxf`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}
