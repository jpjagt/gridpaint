import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { GridLayer } from "@/lib/blob-engine/types"

describe("single-group half-offset through engine dispatch", () => {
  it("applies the +0.5 shift even for a single-group layer (no overrides)", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["3,3"]), offsetPhase: "half" }],
    }
    const engine = new BlobEngine({ enableCaching: false })
    const geo = engine.generateLayerGeometry(layer, 10, 0)
    expect(geo.primitives.length).toBeGreaterThan(0)
    // Every primitive center must be shifted to a .5 coordinate
    const allShifted = geo.primitives.every(
      (p) => p.center.x % 1 !== 0 && p.center.y % 1 !== 0,
    )
    expect(allShifted).toBe(true)
  })

  it("also applies the shift on the cached engine path", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["3,3"]), offsetPhase: "half" }],
    }
    const engine = new BlobEngine({ enableCaching: true })
    const geo = engine.generateLayerGeometry(layer, 10, 0, { minX: -10, minY: -10, maxX: 10, maxY: 10 })
    expect(geo.primitives.length).toBeGreaterThan(0)
    const allShifted = geo.primitives.every(
      (p) => p.center.x % 1 !== 0 && p.center.y % 1 !== 0,
    )
    expect(allShifted).toBe(true)
  })

  it("normal single-group layer keeps integer centers", () => {
    const layer: GridLayer = {
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["3,3"]) }],
    }
    const engine = new BlobEngine({ enableCaching: false })
    const geo = engine.generateLayerGeometry(layer, 10, 0)
    expect(geo.primitives.every((p) => Number.isInteger(p.center.x) && Number.isInteger(p.center.y))).toBe(true)
  })
})
