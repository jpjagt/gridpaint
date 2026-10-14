import type { Cutout, CutoutToolSettings } from "@/types/gridpaint"
import type { Layer } from "@/stores/drawingStores"
import { getLayersWithPoint, getTopBottomLayersWithPoint } from "@/lib/gridpaint/layerUtils"
import { getCutoutGeometry } from "@/lib/gridpaint/cutoutGeometry"

export function cutoutFromSettings(settings: CutoutToolSettings): Cutout {
  return {
    shape: settings.shape,
    anchor: settings.anchor,
    sizeUnit: settings.sizeUnit,
    diameterMm: settings.diameterMm,
    ...(settings.sizeUnit === "grid" ? { diameterGrid: settings.diameterGrid } : {}),
    ...(settings.anchor === "custom" ? { customOffset: { ...settings.customOffset } } : {}),
  }
}

/** The endpoint is stored relative to the first center so moving/copying a point moves the whole pill. */
export function finishPillCutout(
  first: Cutout,
  firstPoint: { x: number; y: number },
  second: Cutout,
  secondPoint: { x: number; y: number },
): Cutout {
  const start = getCutoutGeometry(first, firstPoint.x, firstPoint.y, 1).start
  const end = getCutoutGeometry(second, secondPoint.x, secondPoint.y, 1).start
  return { ...first, shape: "pill", endOffset: { x: end.x - start.x, y: end.y - start.y } }
}

export function isDuplicateCutout(existing: Cutout[], candidate: Cutout): boolean {
  return existing.some(cutout => {
    if ((cutout.sizeUnit ?? "mm") !== (candidate.sizeUnit ?? "mm")) return false
    if ((cutout.shape ?? "circle") !== (candidate.shape ?? "circle")) return false
    const a = getCutoutGeometry(cutout, 0, 0, 1)
    const b = getCutoutGeometry(candidate, 0, 0, 1)
    const tolerance = candidate.sizeUnit === "grid" ? 0.001 : 0.05
    if (Math.abs(a.radius - b.radius) > tolerance) return false
    const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y) < 0.01
    return (same(a.start, b.start) && same(a.end, b.end)) ||
      (same(a.start, b.end) && same(a.end, b.start))
  })
}

export function createRivetCutouts(
  pointKey: string,
  base: Cutout,
  rivetScalePercent: number,
  layers: Layer[],
): Map<number, Cutout> {
  const result = new Map<number, Cutout>()
  const layersWithPoint = getLayersWithPoint(pointKey, layers)
  const { topId, bottomId } = getTopBottomLayersWithPoint(pointKey, layers)

  layersWithPoint.forEach(layer => {
    const scale = layer.id === topId || layer.id === bottomId ? rivetScalePercent / 100 : 1
    result.set(layer.id, {
      ...base,
      diameterMm: base.diameterMm * scale,
      ...(base.sizeUnit === "grid" ? { diameterGrid: (base.diameterGrid ?? 0.5) * scale } : {}),
    })
  })
  return result
}
