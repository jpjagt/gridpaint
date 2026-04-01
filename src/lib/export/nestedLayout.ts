/**
 * Nested Layout Export - Guillotine Packing Algorithm
 *
 * Provides shape-aware packing for efficient tiling and holder exports.
 */

import { GuillotineBinPack, Rect } from "rectangle-packer"
import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import {
  generateLayerSvgContent,
  convertLayerToGridLayer,
} from "@/lib/export/svgUtils"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { GridLayer } from "@/lib/blob-engine/types"
import { getGridLayerPoints } from "@/lib/blob-engine/types"
import { filterOuterPaths } from "@/lib/export/pathUtils"

export function getLayerBoundingBox(
  layer: GridLayer,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  for (const pointStr of getGridLayerPoints(layer)) {
    const [x, y] = pointStr.split(",").map(Number)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

export function shiftLayer(
  layer: GridLayer,
  deltaX: number,
  deltaY: number,
): GridLayer {
  const newGroups = layer.groups.map((group) => ({
    ...group,
    points: new Set(
      Array.from(group.points).map((pointStr) => {
        const [x, y] = pointStr.split(",").map(Number)
        return `${x + deltaX},${y + deltaY}`
      }),
    ),
  }))

  return { ...layer, groups: newGroups }
}

export interface ShapeData {
  id: string
  width: number
  height: number
  layerName?: string
  layer: GridLayer
  offsetX: number
  offsetY: number
}

export interface PackedItem {
  id: string
  x: number
  y: number
  width: number
  height: number
  layerName?: string
  layer: GridLayer
  offsetX: number
  offsetY: number
}

export interface PackingOptions {
  margin: number
  outerMargin: number
}

export interface PackedResult {
  items: PackedItem[]
  totalWidth: number
  totalHeight: number
}

export function packShapes(
  items: ShapeData[],
  options: PackingOptions,
): PackedResult {
  if (items.length === 0) {
    return { items: [], totalWidth: 0, totalHeight: 0 }
  }

  const { margin, outerMargin } = options
  const binWidth = 10000
  const binHeight = 10000

  const packer = new GuillotineBinPack(binWidth, binHeight, false)

  const sizes = items.map(
    (item) => new Rect(0, 0, item.width + margin, item.height + margin),
  )

  packer.InsertSizes(
    sizes,
    true,
    GuillotineBinPack.FreeRectChoiceHeuristic.RectBestShortSideFit,
    GuillotineBinPack.GuillotineSplitHeuristic.SplitShorterAxis,
  )

  const idToItem = new Map(items.map((item, idx) => [idx, item]))

  const placedItems: PackedItem[] = []

  for (let i = 0; i < packer.usedRectangles.length; i++) {
    const usedRect = packer.usedRectangles[i]
    const originalItem = idToItem.get(i)
    if (!originalItem) continue

    placedItems.push({
      id: originalItem.id,
      x: usedRect.x + outerMargin,
      y: usedRect.y + outerMargin,
      width: usedRect.width - margin,
      height: usedRect.height - margin,
      layerName: originalItem.layerName,
      layer: originalItem.layer,
      offsetX: originalItem.offsetX,
      offsetY: originalItem.offsetY,
    })
  }

  let maxX = 0
  let maxY = 0
  for (const item of placedItems) {
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }

  return {
    items: placedItems,
    totalWidth: maxX + outerMargin,
    totalHeight: maxY + outerMargin,
  }
}

export function generateHolderOutline(
  width: number,
  height: number,
  outerMargin: number,
): string {
  const x = outerMargin
  const y = outerMargin
  const w = width - outerMargin * 2
  const h = height - outerMargin * 2
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
}

function getLayerSvgBounds(
  gridLayer: GridLayer,
  gridSize: number,
  borderWidth: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(gridLayer, gridSize, borderWidth)
  if (geometry.primitives.length === 0) return null
  const { min, max } = geometry.boundingBox
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }
}

export function generateHolderPreviewSvg(
  exportRects: ExportRect[],
  layers: Layer[],
  gridSize: number,
  borderWidth: number,
  mmPerUnit: number,
): string {
  const MARGIN = 2
  const OUTER_MARGIN = 5

  const shapeData: ShapeData[] = []
  const visibleLayers = layers.filter((l) => l.isVisible)

  exportRects.forEach((rect, rectIdx) => {
    const clippedLayers = clipLayersToSelection(visibleLayers, rect)

    clippedLayers.forEach((layer) => {
      const gridLayer = convertLayerToGridLayer(layer)
      const svgBounds = getLayerSvgBounds(gridLayer, gridSize, borderWidth)
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

  if (shapeData.length === 0) {
    return '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'
  }

  const packed = packShapes(shapeData, {
    margin: MARGIN,
    outerMargin: OUTER_MARGIN,
  })

  const paths: string[] = []

  const outline = generateHolderOutline(
    packed.totalWidth,
    packed.totalHeight,
    OUTER_MARGIN,
  )
  paths.push(
    `<path d="${outline}" fill="none" stroke="#666" stroke-width="0.2" stroke-dasharray="1,0.5"/>`,
  )

  packed.items.forEach((item) => {
    const deltaX = item.x + item.offsetX
    const deltaY = item.y + item.offsetY

    const shiftedLayer = shiftLayer(item.layer, deltaX, deltaY)

    const content = generateLayerSvgContent(
      shiftedLayer,
      gridSize,
      borderWidth,
      {
        strokeColor: "#000",
        strokeWidth: 0.1,
        fillColor: "transparent",
        opacity: 1,
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

  const physW = packed.totalWidth * mmPerUnit
  const physH = packed.totalHeight * mmPerUnit

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${physW}mm"
     height="${physH}mm"
     viewBox="0 0 ${packed.totalWidth} ${packed.totalHeight}">
${paths.join("\n")}
</svg>`
}
