// @vitest-environment node
import { describe, it, expect } from "vitest"
import { basePlate, PLATE_MARGIN } from "@/lib/rig/plate"
import { area, bounds, contains, pieces, rect, union } from "@/lib/rig/clip"

describe("basePlate", () => {
  it("follows the footprint with a margin instead of the bounding box", () => {
    // An L shape: its bounding box would waste the empty corner
    const l = union(rect(0, 0, 30, 5), rect(0, 0, 5, 30))
    const plate = basePlate(l)
    const b = bounds(plate)
    expect(b.minX).toBeCloseTo(-PLATE_MARGIN, 1)
    expect(b.maxX).toBeCloseTo(30 + PLATE_MARGIN, 1)
    expect(contains(plate, { x: 20, y: 20 })).toBe(false)
    expect(area(plate)).toBeLessThan(0.5 * 34 * 34)
  })

  it("joins separate islands into one piece", () => {
    const islands = union(rect(0, 0, 5, 5), rect(40, 0, 45, 5), rect(0, 40, 5, 45))
    const plate = basePlate(islands)
    expect(pieces(plate)).toHaveLength(1)
    // Bridges, not a filled box
    expect(contains(plate, { x: 30, y: 30 })).toBe(false)
  })
})
