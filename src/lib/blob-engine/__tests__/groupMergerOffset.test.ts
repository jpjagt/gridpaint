import { describe, it, expect } from "vitest"
import { GroupMerger } from "@/lib/blob-engine/GroupMerger"
import type { GridLayer } from "@/lib/blob-engine/types"

function makeLayer(offsetPhase: "normal" | "half"): GridLayer {
  return {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["3,3"]), offsetPhase }],
  }
}

describe("GroupMerger half-offset", () => {
  it("shifts a half-offset group's primitive centers by +0.5 in both dims", () => {
    const merger = new GroupMerger()
    const normal = merger.generateMergedPrimitives(makeLayer("normal"), 10, 0).primitives
    const half = merger.generateMergedPrimitives(makeLayer("half"), 10, 0).primitives

    expect(half.length).toBe(normal.length)
    expect(half.length).toBeGreaterThan(0)

    const normalCenters = normal.map((p) => `${p.center.x},${p.center.y}:${p.quadrant}`).sort()
    const halfShiftedBack = half
      .map((p) => `${p.center.x - 0.5},${p.center.y - 0.5}:${p.quadrant}`)
      .sort()
    expect(halfShiftedBack).toEqual(normalCenters)
  })

  it("leaves normal groups unshifted", () => {
    const merger = new GroupMerger()
    const normal = merger.generateMergedPrimitives(makeLayer("normal"), 10, 0).primitives
    for (const p of normal) {
      expect(Number.isInteger(p.center.x)).toBe(true)
      expect(Number.isInteger(p.center.y)).toBe(true)
    }
  })
})
