/**
 * Render a gridlab-design to a <canvas> with the blob engine (gridSize = 1,
 * scaled via the context transform). Pure aside from the canvas it draws to.
 */

import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { appendPrimitivesPath } from "@/lib/blob-engine/renderers/primitivePaths"
import { getLayerFillColor } from "@/lib/gridpaint/layerColors"
import { designLayerIds, designToGridLayers } from "@/lib/lab/designConvert"
import type { LabDesign, LabPalette, LabPaletteMode, LabRenderOptions } from "@/types/lab"

export const JEWEL_BACKGROUND = "#020817"
/** Layer fills by rank from the top layer. */
export const JEWEL_COLORS = ["#b8c6dc", "#8fa5c2", "#6680a6", "#4a5f80", "#3a4c68", "#2c3a52"]
export const JEWEL_SINGLE = "#8fa5c2"

export function jewelColor(rank: number, layerCount: number): string {
  if (layerCount <= 1) return JEWEL_SINGLE
  return JEWEL_COLORS[Math.min(Math.max(rank, 0), JEWEL_COLORS.length - 1)]
}

const jewelPalette: LabPalette = {
  mode: "jewel",
  background: JEWEL_BACKGROUND,
  colorFor: (_id, rank, count) => jewelColor(rank, count),
}

function readCssHsl(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw ? `hsl(${raw})` : fallback
}

/** Resolve a palette; theme mode reads CSS variables once (cached per id). */
export function resolvePalette(mode: LabPaletteMode): LabPalette {
  if (mode === "jewel") return jewelPalette
  const background = readCssHsl("--canvas-background", "#ffffff")
  const cache = new Map<string, string>()
  return {
    mode,
    background,
    colorFor: (id) => {
      const key = String(id)
      let c = cache.get(key)
      if (!c) {
        c = getLayerFillColor(id, { min: Math.min(1, id), max: Math.max(6, id) })
        cache.set(key, c)
      }
      return c
    },
  }
}

const engine = new BlobEngine({ enableCaching: false })

/** CSS-px size the canvas will get for these options. */
export function renderedSize(
  design: LabDesign,
  opts: Pick<LabRenderOptions, "cellPx" | "fit" | "padding">,
): { width: number; height: number; cellPx: number } {
  if (opts.fit) {
    const cellPx = Math.max(
      0.25,
      Math.min(
        (opts.fit.width - 2 * opts.padding) / Math.max(1, design.width),
        (opts.fit.height - 2 * opts.padding) / Math.max(1, design.height),
      ),
    )
    return { width: opts.fit.width, height: opts.fit.height, cellPx }
  }
  const cellPx = opts.cellPx ?? 8
  return {
    width: Math.ceil(design.width * cellPx + 2 * opts.padding),
    height: Math.ceil(design.height * cellPx + 2 * opts.padding),
    cellPx,
  }
}

export function renderDesignToCanvas(
  canvas: HTMLCanvasElement,
  design: LabDesign,
  opts: LabRenderOptions,
): void {
  const dpr = opts.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
  const { width, height, cellPx } = renderedSize(design, opts)
  const pw = Math.round(width * dpr)
  const ph = Math.round(height * dpr)
  if (canvas.width !== pw) canvas.width = pw
  if (canvas.height !== ph) canvas.height = ph
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = opts.palette.background
  ctx.fillRect(0, 0, pw, ph)

  // Centre the design in the canvas.
  const ox = (width - design.width * cellPx) / 2
  const oy = (height - design.height * cellPx) / 2
  const s = cellPx * dpr
  ctx.setTransform(s, 0, 0, s, ox * dpr, oy * dpr)

  // Ranks are relative to all of the design's layers, so toggling a layer or
  // scrubbing frames never re-colours the others.
  const allIds = designLayerIds(design)
  const layers = designToGridLayers(design, opts.frameIndex, opts.layerIds)
  // Paint highest id first; layer with the lowest id (top) last.
  layers.sort((a, b) => b.id - a.id)
  for (const layer of layers) {
    const geometry = engine.generateLayerGeometry(layer, 1, 0)
    if (geometry.primitives.length === 0) continue
    const path = new Path2D()
    appendPrimitivesPath(path, geometry.primitives, 1)
    ctx.fillStyle = opts.palette.colorFor(layer.id, allIds.indexOf(layer.id), allIds.length)
    ctx.fill(path)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
