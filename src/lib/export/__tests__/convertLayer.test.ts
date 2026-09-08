import { describe, it, expect, vi } from "vitest"

// Mock firebase modules to prevent env var errors when svgUtils is imported
// (svgUtils → drawingStores → storage/store → storage-manager → hybrid-store → firestore-store → firebase)
vi.mock("@/lib/firebase/config", () => ({ app: {} }))
vi.mock("@/lib/firebase/firestore", () => ({ db: {} }))

import { convertLayerToGridLayer } from "@/lib/export/svgUtils"
import type { Layer } from "@/stores/drawingStores"

describe("convertLayerToGridLayer", () => {
  it("preserves group offset phases and layer scale", () => {
    const layer: Layer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "h", points: new Set(["1,1"]), offsetPhaseX: "half", offsetPhaseY: "normal" }],
      scale: { num: 2, den: 1 },
    }
    const grid = convertLayerToGridLayer(layer)
    expect(grid.groups[0].offsetPhaseX).toBe("half")
    expect(grid.groups[0].offsetPhaseY).toBe("normal")
    expect(grid.scale).toEqual({ num: 2, den: 1 })
  })
})
