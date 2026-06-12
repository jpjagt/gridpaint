import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import type { GridLayer } from "@/lib/blob-engine/types"

function layer(scale?: { num: number; den: number }): GridLayer {
  return {
    id: 1, isVisible: true, renderStyle: "default",
    groups: [{ id: "g", points: new Set(["2,2", "3,2", "2,3", "3,3"]) }],
    scale,
  }
}

describe("composite bounds account for per-layer scale", () => {
  it("doubles the composite bbox extent for a 2x layer", () => {
    const engine = new BlobEngine({ enableCaching: false })
    const base = engine.generateGeometry([layer()], 10, 0).boundingBox
    const scaled = engine.generateGeometry([layer({ num: 2, den: 1 })], 10, 0).boundingBox
    const baseW = base.max.x - base.min.x
    const scaledW = scaled.max.x - scaled.min.x
    expect(baseW).toBeGreaterThan(0)
    expect(scaledW).toBeCloseTo(baseW * 2, 6)
    // min also scales (about origin)
    expect(scaled.min.x).toBeCloseTo(base.min.x * 2, 6)
    expect(scaled.max.x).toBeCloseTo(base.max.x * 2, 6)
  })

  it("halves the composite bbox extent for a 1/2 layer", () => {
    const engine = new BlobEngine({ enableCaching: false })
    const base = engine.generateGeometry([layer()], 10, 0).boundingBox
    const scaled = engine.generateGeometry([layer({ num: 1, den: 2 })], 10, 0).boundingBox
    const baseW = base.max.x - base.min.x
    const scaledW = scaled.max.x - scaled.min.x
    expect(scaledW).toBeCloseTo(baseW / 2, 6)
  })
})
