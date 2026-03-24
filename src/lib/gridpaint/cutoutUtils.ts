import type { CircularCutout, CutoutAnchor } from "@/types/gridpaint"
import type { Layer } from "@/stores/drawingStores"
import { getLayersWithPoint, getTopBottomLayersWithPoint } from "./layerUtils"

export function createRivetCutouts(
  pointKey: string,
  anchor: CutoutAnchor,
  baseDiameterMm: number,
  rivetScalePercent: number,
  customOffset: { x: number; y: number },
  layers: Layer[],
): Map<number, CircularCutout> {
  const result = new Map<number, CircularCutout>()
  const layersWithPoint = getLayersWithPoint(pointKey, layers)

  if (layersWithPoint.length === 0) return result

  const { topId, bottomId } = getTopBottomLayersWithPoint(pointKey, layers)
  const scale = rivetScalePercent / 100

  layersWithPoint.forEach((layer) => {
    const isTopOrBottom = layer.id === topId || layer.id === bottomId
    const diameter = isTopOrBottom ? baseDiameterMm * scale : baseDiameterMm

    const cutout: CircularCutout = {
      anchor,
      diameterMm: diameter,
      ...(anchor === "custom" ? { customOffset } : {}),
    }
    result.set(layer.id, cutout)
  })

  return result
}
