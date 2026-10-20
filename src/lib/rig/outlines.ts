/**
 * Layer footprints for an export rect, in mm, in the canvas SVG frame
 * (grid point (x, y) is centred at (x, y) · mmPerUnit, y down).
 */

import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type { Region, RigLayer, Vec2 } from "@/types/rig"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import { svgPathRings } from "@/lib/rig/svgRings"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
import { pieces, union, ringArea } from "@/lib/rig/clip"

/** Spacing of outline samples used for contact tests (mm). */
export const SAMPLE_STEP = 0.25

/** A layer's footprint inside the rect, in mm. Empty region if none. */
export function layerFootprint(
  layer: Layer,
  rect: ExportRect,
  gridSize: number,
  borderWidth: number,
  mmPerUnit: number,
): Region {
  const [clipped] = clipLayersToSelection([layer], rect)
  if (!clipped) return []
  // Same pipeline as generateLayerSvgContent, minus its store imports, so
  // this also runs in the rig worker
  const gridLayer: GridLayer = {
    id: clipped.id,
    groups: clipped.groups.map((g) => ({ ...g, points: new Set(g.points) })),
    isVisible: true,
    renderStyle: clipped.renderStyle || "default",
    pointModifications: clipped.pointModifications,
    scale: clipped.scale,
  }
  const geometry = new BlobEngine({ enableCaching: false }).generateLayerGeometry(
    gridLayer,
    gridSize,
    borderWidth,
  )
  if (geometry.primitives.length === 0) return []
  const svg = new SvgPathRenderer(false).renderLayer(
    geometry,
    { strokeColor: "#000", strokeWidth: 0.1, fillColor: "transparent", opacity: 1 },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    gridLayer,
    mmPerUnit,
    true,
  )
  if (!svg) return []
  const k = scaleToFactor(layer.scale) * mmPerUnit
  const rings = svgPathRings(svg)
  return union(rings.map((ring) => ring.map((p) => ({ x: p.x * k, y: p.y * k }))))
}

/**
 * Visible layers of the rect in assembly order. Default: highest id first
 * (face up, layer 1 ends on top); `reverse` puts layer 1 first (face down).
 */
export function rigLayers(
  layers: Layer[],
  rect: ExportRect,
  gridSize: number,
  borderWidth: number,
  mmPerUnit: number,
  reverse: boolean,
): RigLayer[] {
  const ordered = layers
    .filter((l) => l.isVisible)
    .sort((a, b) => (reverse ? a.id - b.id : b.id - a.id))
  const out: RigLayer[] = []
  for (const layer of ordered) {
    const footprint = layerFootprint(layer, rect, gridSize, borderWidth, mmPerUnit)
    if (footprint.length === 0) continue
    out.push({
      layerId: layer.id,
      order: out.length,
      footprint,
      pieces: pieces(footprint).map((piece) => {
        const region = [piece.outer, ...piece.holes]
        return { footprint: region, ...outlineSamples(region) }
      }),
    })
  }
  return out
}

function outlineSamples(region: Region): {
  samples: { p: Vec2; n: Vec2 }[]
  center: Vec2
  radius: number
} {
  const samples: { p: Vec2; n: Vec2 }[] = []
  let cx = 0
  let cy = 0
  let count = 0
  for (const ring of region) {
    // Outers have positive area (clockwise on screen); the outward normal
    // of a clockwise-on-screen edge (dx, dy) is (dy, -dx) in y-down.
    const sign = ringArea(ring) > 0 ? 1 : -1
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      const n = { x: (sign * dy) / len, y: (sign * -dx) / len }
      const steps = Math.max(1, Math.round(len / SAMPLE_STEP))
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps
        const p = { x: a.x + dx * t, y: a.y + dy * t }
        samples.push({ p, n })
        cx += p.x
        cy += p.y
        count++
      }
    }
  }
  const center = { x: cx / Math.max(1, count), y: cy / Math.max(1, count) }
  let radius = 1
  for (const { p } of samples)
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y))
  return { samples, center, radius }
}
