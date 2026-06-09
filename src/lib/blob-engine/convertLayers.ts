/**
 * Canonical Layer (store) → GridLayer (blob engine) conversion.
 *
 * Lives in blob-engine (no export/SVG deps) so both the live canvas and the
 * export paths can share one converter. Must carry EVERY field the engine and
 * renderers consume — notably per-group `offsetPhase` and per-layer `scale`.
 * A converter that drops a field silently disables that feature on whichever
 * path uses it (this is exactly how half-offset/scale once failed to render on
 * the live canvas).
 */

import type { Layer } from "@/stores/drawingStores"
import type { GridLayer } from "@/lib/blob-engine/types"

export function layerToGridLayer(layer: Layer): GridLayer {
  return {
    id: layer.id,
    groups: layer.groups.map((g) => ({
      id: g.id,
      name: g.name,
      points: new Set(g.points),
      offsetPhase: g.offsetPhase,
    })),
    isVisible: layer.isVisible,
    renderStyle: layer.renderStyle || "default",
    pointModifications: layer.pointModifications,
    scale: layer.scale,
  }
}

export function layersToGridLayers(layers: Layer[]): GridLayer[] {
  return layers.map(layerToGridLayer)
}
