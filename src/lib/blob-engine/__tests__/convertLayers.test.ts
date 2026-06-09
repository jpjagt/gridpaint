import { describe, it, expect } from "vitest"
import { layerToGridLayer } from "@/lib/blob-engine/convertLayers"
import type { Layer } from "@/stores/drawingStores"

describe("layerToGridLayer", () => {
  it("carries per-group offsetPhase and per-layer scale to the engine layer", () => {
    const layer: Layer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [
        { id: "n", points: new Set(["0,0"]) },
        { id: "h", points: new Set(["1,1"]), offsetPhase: "half" },
      ],
      scale: { num: 2, den: 1 },
    }
    const grid = layerToGridLayer(layer)
    expect(grid.scale).toEqual({ num: 2, den: 1 })
    expect(grid.groups.find((g) => g.id === "h")!.offsetPhase).toBe("half")
    expect(grid.groups.find((g) => g.id === "n")!.offsetPhase).toBeUndefined()
  })

  it("converts points to a fresh Set (no shared reference)", () => {
    const src = new Set(["2,2"])
    const layer: Layer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "g", points: src }],
    }
    const grid = layerToGridLayer(layer)
    expect(grid.groups[0].points).not.toBe(src)
    expect(grid.groups[0].points.has("2,2")).toBe(true)
  })
})
