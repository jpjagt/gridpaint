// @vitest-environment node
import { describe, it, expect } from "vitest"
import { layerFootprint, rigLayers } from "@/lib/rig/outlines"
import { area, bounds, contains } from "@/lib/rig/clip"
import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

export function makeLayer(id: number, points: string[]): Layer {
  return {
    id,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: `g${id}`, points: new Set(points) }],
  }
}

const rect: ExportRect = { id: "r", minX: 0, minY: 0, maxX: 10, maxY: 10, quantity: 1 }

describe("layerFootprint", () => {
  it("puts a single point as a disk centred on the point, in mm", () => {
    const fp = layerFootprint(makeLayer(1, ["3,4"]), rect, 50, 0, 2)
    const b = bounds(fp)
    expect(b.minX).toBeCloseTo(5, 1)
    expect(b.maxX).toBeCloseTo(7, 1)
    expect(b.minY).toBeCloseTo(7, 1)
    expect(b.maxY).toBeCloseTo(9, 1)
    expect(area(fp)).toBeCloseTo(Math.PI, 1)
    expect(contains(fp, { x: 6, y: 8 })).toBe(true)
  })

  it("orders layers highest id first, outward normals point out", () => {
    const ls = rigLayers(
      [makeLayer(1, ["1,1"]), makeLayer(2, ["1,1", "2,1"])],
      rect,
      50,
      0,
      1,
      false,
    )
    expect(ls.map((l) => l.layerId)).toEqual([2, 1])
    for (const { p, n } of ls[1].samples) {
      expect(contains(ls[1].footprint, { x: p.x + n.x * 0.05, y: p.y + n.y * 0.05 })).toBe(false)
      expect(contains(ls[1].footprint, { x: p.x - n.x * 0.05, y: p.y - n.y * 0.05 })).toBe(true)
    }
  })
})
