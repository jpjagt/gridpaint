/**
 * Pure conversions between gridlab-design JSON, the blob engine's GridLayer,
 * the store's Layer, gridpaint-selection clipboard JSON and DrawingDocument.
 */

import type { GridLayer } from "@/lib/blob-engine/types"
import type { Layer } from "@/stores/drawingStores"
import type { DrawingDocument } from "@/lib/storage/types"
import type { ExportRect } from "@/types/gridpaint"
import type { LayerRange } from "@/types/layers"
import { LAYER_RANGE_LIMIT } from "@/types/layers"
import { DEFAULT_MM_PER_UNIT } from "@/lib/constants"
import type {
  GridpaintSelectionPayload,
  LabDesign,
  LabLayer,
} from "@/types/lab"

/** Layers of the final design or of a frame. */
export function designLayersAt(design: LabDesign, frameIndex?: number): LabLayer[] {
  if (frameIndex !== undefined && design.frames && design.frames[frameIndex]) {
    return design.frames[frameIndex].layers
  }
  return design.layers
}

/** All layer ids of a design (final + frames), ascending (top first). */
export function designLayerIds(design: LabDesign): number[] {
  const ids = new Set<number>()
  for (const l of design.layers) ids.add(l.id)
  for (const f of design.frames ?? []) for (const l of f.layers) ids.add(l.id)
  return [...ids].sort((a, b) => a - b)
}

export function labLayerToGridLayer(layer: LabLayer): GridLayer {
  return {
    id: layer.id,
    isVisible: true,
    renderStyle: "default",
    groups: layer.groups.map((g) => ({ id: g.id, points: new Set(g.points) })),
  }
}

export function gridLayerToLabLayer(layer: GridLayer): LabLayer {
  return {
    id: layer.id,
    groups: layer.groups.map((g) => ({ id: g.id, points: [...g.points] })),
  }
}

export function designToGridLayers(
  design: LabDesign,
  frameIndex?: number,
  layerIds?: number[],
): GridLayer[] {
  const only = layerIds ? new Set(layerIds) : null
  return designLayersAt(design, frameIndex)
    .filter((l) => !only || only.has(l.id))
    .map(labLayerToGridLayer)
}

/** Store layers (Sets), sorted by id ascending. */
export function designToStoreLayers(design: LabDesign): Layer[] {
  return [...design.layers]
    .sort((a, b) => a.id - b.id)
    .map((l) => ({
      id: l.id,
      isVisible: true,
      renderStyle: "default" as const,
      groups: l.groups.map((g) => ({ id: g.id, points: new Set(g.points) })),
    }))
}

export function countPoints(design: LabDesign): number {
  let n = 0
  for (const l of design.layers) {
    const all = new Set<string>()
    for (const g of l.groups) for (const p of g.points) all.add(p)
    n += all.size
  }
  return n
}

/** Clipboard payload; bounds are the design frame, so the layout is preserved. */
export function designToSelection(
  design: LabDesign,
  timestamp: number = Date.now(),
): GridpaintSelectionPayload {
  return {
    type: "gridpaint-selection",
    version: "2.0.0",
    data: {
      layers: [...design.layers]
        .sort((a, b) => a.id - b.id)
        .map((l) => ({
          layerId: l.id,
          groups: l.groups
            .filter((g) => g.points.length > 0)
            .map((g) => ({ id: g.id, points: [...g.points] })),
        }))
        .filter((l) => l.groups.length > 0),
      bounds: { minX: 0, minY: 0, maxX: design.width - 1, maxY: design.height - 1 },
      timestamp,
    },
  }
}

function parsePoint(p: string): [number, number] {
  const [x, y] = p.split(",").map(Number)
  return [x, y]
}

/** Shift all points so the design's bounding box starts at 0,0 and fix width/height. */
export function normalizeDesign(design: LabDesign): LabDesign {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const all = [design.layers, ...(design.frames ?? []).map((f) => f.layers)]
  for (const layers of all)
    for (const l of layers)
      for (const g of l.groups)
        for (const p of g.points) {
          const [x, y] = parsePoint(p)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
  if (minX === Infinity) return design
  if (minX >= 0 && minY >= 0 && maxX < design.width && maxY < design.height) return design
  const shift = (layers: LabLayer[]): LabLayer[] =>
    layers.map((l) => ({
      id: l.id,
      groups: l.groups.map((g) => ({
        id: g.id,
        points: g.points.map((p) => {
          const [x, y] = parsePoint(p)
          return `${x - minX},${y - minY}`
        }),
      })),
    }))
  return {
    ...design,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    layers: shift(design.layers),
    frames: design.frames?.map((f) => ({ label: f.label, layers: shift(f.layers) })),
  }
}

export function selectionToDesign(
  payload: GridpaintSelectionPayload,
  id: string,
  title = "Pasted selection",
): LabDesign {
  const { bounds, layers } = payload.data
  return normalizeDesign({
    type: "gridlab-design",
    version: 1,
    id,
    title,
    recipe: "pasted",
    params: {},
    seed: null,
    tags: ["pasted"],
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
    layers: layers.map((l) => ({
      id: l.layerId,
      groups: l.groups.map((g) => ({ id: g.id, points: [...g.points] })),
    })),
  })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

/**
 * Parse pasted/dropped text: a gridlab-design, a gridpaint-selection, or a
 * gridlab-gallery (all designs). Returns [] when nothing is recognised.
 */
export function parseLabInput(text: string, idPrefix = "pasted"): LabDesign[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!isObject(data)) return []
  if (data.type === "gridlab-design" && Array.isArray(data.layers)) {
    const d = data as unknown as LabDesign
    return [
      normalizeDesign({
        ...d,
        id: `${idPrefix}:${d.id ?? "design"}`,
        tags: [...(d.tags ?? []), "pasted"],
        params: d.params ?? {},
        seed: d.seed ?? null,
        title: d.title ?? "Pasted design",
        recipe: d.recipe ?? "pasted",
      }),
    ]
  }
  if (
    data.type === "gridpaint-selection" &&
    isObject(data.data) &&
    Array.isArray(data.data.layers) &&
    isObject(data.data.bounds)
  ) {
    return [selectionToDesign(data as unknown as GridpaintSelectionPayload, `${idPrefix}:selection`)]
  }
  if (data.type === "gridlab-gallery" && Array.isArray(data.sections)) {
    const out: LabDesign[] = []
    for (const s of data.sections as { designs?: LabDesign[] }[])
      for (const d of s.designs ?? []) out.push({ ...d, id: `${idPrefix}:${d.id}` })
    return out
  }
  return []
}

export function designLayerRange(design: LabDesign): LayerRange {
  const ids = designLayerIds(design)
  const min = Math.max(LAYER_RANGE_LIMIT.min, Math.min(1, ...ids))
  const max = Math.min(LAYER_RANGE_LIMIT.max, Math.max(6, ...ids))
  return { min, max }
}

/** Inclusive export rect covering the whole design (for 3D preview). */
export function designExportRect(design: LabDesign): ExportRect {
  return {
    id: `lab-${design.id}`,
    minX: 0,
    minY: 0,
    maxX: design.width - 1,
    maxY: design.height - 1,
    quantity: 1,
    name: design.title,
  }
}

/** Zoom/pan so the design (cells [0,W)x[0,H)) is centred in the viewport. */
export function fitView(
  design: LabDesign,
  gridSize: number,
  viewport: { width: number; height: number },
): { zoom: number; panOffset: { x: number; y: number } } {
  const contentW = (design.width + 4) * gridSize
  const contentH = (design.height + 4) * gridSize
  const zoom = Math.max(0.005, Math.min(viewport.width / contentW, viewport.height / contentH, 2))
  const cx = (design.width / 2) * gridSize
  const cy = (design.height / 2) * gridSize
  return {
    zoom,
    panOffset: { x: viewport.width / 2 - cx * zoom, y: viewport.height / 2 - cy * zoom },
  }
}

export function buildDrawingDocument(
  design: LabDesign,
  opts: { id: string; now: number; viewport: { width: number; height: number } },
): DrawingDocument {
  const gridSize = 75
  const { zoom, panOffset } = fitView(design, gridSize, opts.viewport)
  const seed = design.seed !== null && design.seed !== undefined ? ` s${design.seed}` : ""
  return {
    id: opts.id,
    name: `lab: ${design.title}${seed}`,
    createdAt: opts.now,
    updatedAt: opts.now,
    gridSize,
    borderWidth: 0.5,
    panOffset,
    zoom,
    mmPerUnit: DEFAULT_MM_PER_UNIT,
    layerRange: designLayerRange(design),
    layers: designToStoreLayers(design),
  }
}
