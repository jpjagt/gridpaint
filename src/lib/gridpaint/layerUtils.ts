import type { Layer } from "@/stores/drawingStores"

export function getLayersWithPoint(pointKey: string, layers: Layer[]): Layer[] {
  return layers.filter((layer) => {
    for (const group of layer.groups) {
      if (group.points.has(pointKey)) return true
    }
    return false
  })
}

export function getTopBottomLayersWithPoint(
  pointKey: string,
  layers: Layer[],
): { topId: number | null; bottomId: number | null } {
  const layersWithPoint = getLayersWithPoint(pointKey, layers)
  if (layersWithPoint.length === 0) return { topId: null, bottomId: null }

  const ids = layersWithPoint.map((l) => l.id)
  return {
    topId: Math.max(...ids),
    bottomId: Math.min(...ids),
  }
}
