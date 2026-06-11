import { describe, it, expect } from "vitest"
import { rasterizeShape, buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"

const sorted = (keys: string[]) => [...keys].sort()

describe("rasterizeShape — rectangle (high exponent)", () => {
  it("fills every cell of the bbox at n=8", () => {
    expect(sorted(rasterizeShape("rectangle", "fill", 4, 4, 8))).toEqual(
      sorted([
        "0,0","1,0","2,0","3,0",
        "0,1","1,1","2,1","3,1",
        "0,2","1,2","2,2","3,2",
        "0,3","1,3","2,3","3,3",
      ]),
    )
  })

  it("1x1 fill is a single cell", () => {
    expect(rasterizeShape("rectangle", "fill", 1, 1, 8)).toEqual(["0,0"])
  })

  it("edge of a full bbox (n=8) equals the rectangle perimeter", () => {
    expect(sorted(rasterizeShape("rectangle", "edge", 4, 3, 8))).toEqual(
      sorted([
        "0,0", "1,0", "2,0", "3,0",
        "0,1", "3,1",
        "0,2", "1,2", "2,2", "3,2",
      ]),
    )
  })

  it("edge of a thin (height<=2) box equals fill", () => {
    expect(sorted(rasterizeShape("rectangle", "edge", 4, 2, 8))).toEqual(
      sorted(rasterizeShape("rectangle", "fill", 4, 2, 8)),
    )
  })
})

describe("rasterizeShape — ellipse (n=2)", () => {
  it("fill is symmetric horizontally and vertically", () => {
    const w = 7, h = 5
    const set = new Set(rasterizeShape("ellipse", "fill", w, h, 2))
    for (const key of set) {
      const [x, y] = key.split(",").map(Number)
      expect(set.has(`${w - 1 - x},${y}`)).toBe(true)
      expect(set.has(`${x},${h - 1 - y}`)).toBe(true)
    }
  })

  it("fill omits the corners of a large ellipse", () => {
    const set = new Set(rasterizeShape("ellipse", "fill", 9, 9, 2))
    expect(set.has("0,0")).toBe(false)
    expect(set.has("8,0")).toBe(false)
    expect(set.has("4,4")).toBe(true)
  })

  it("edge cells are a subset of fill cells", () => {
    const fill = new Set(rasterizeShape("ellipse", "fill", 9, 7, 2))
    const edge = rasterizeShape("ellipse", "edge", 9, 7, 2)
    for (const key of edge) expect(fill.has(key)).toBe(true)
  })

  it("edge has no filled interior (center cell absent for a large ellipse)", () => {
    const edge = new Set(rasterizeShape("ellipse", "edge", 11, 11, 2))
    expect(edge.has("5,5")).toBe(false)
  })

  it("thin ellipse (height<=2) falls back to fill", () => {
    expect(rasterizeShape("ellipse", "edge", 6, 2, 2).sort()).toEqual(
      rasterizeShape("ellipse", "fill", 6, 2, 2).sort(),
    )
  })
})

describe("rasterizeShape — exponent controls squircliness", () => {
  it("higher exponent fills strictly more cells than a lower one", () => {
    const lo = new Set(rasterizeShape("ellipse", "fill", 9, 9, 2))
    const hi = new Set(rasterizeShape("ellipse", "fill", 9, 9, 8))
    expect(lo.has("0,0")).toBe(false)
    expect(hi.has("0,0")).toBe(true)
    expect(hi.size).toBeGreaterThan(lo.size)
  })

  it("n=1 is a diamond (corners and edge-midpoints differ)", () => {
    const set = new Set(rasterizeShape("ellipse", "fill", 9, 9, 1))
    expect(set.has("0,0")).toBe(false)
    expect(set.has("4,0")).toBe(true)
    expect(set.has("0,4")).toBe(true)
  })
})

describe("rasterizeShape — non-square ellipse & fractional exponent", () => {
  it("9x5 ellipse edge is a true hollow outline (subset of fill, every cell on a boundary)", () => {
    const fill = new Set(rasterizeShape("ellipse", "fill", 9, 5, 2))
    const edge = new Set(rasterizeShape("ellipse", "edge", 9, 5, 2))
    for (const key of edge) expect(fill.has(key)).toBe(true)
    for (const key of edge) {
      const [x, y] = key.split(",").map(Number)
      const hasEmptyNeighbour =
        !fill.has(`${x - 1},${y}`) ||
        !fill.has(`${x + 1},${y}`) ||
        !fill.has(`${x},${y - 1}`) ||
        !fill.has(`${x},${y + 1}`)
      expect(hasEmptyNeighbour).toBe(true)
    }
    expect(fill.has("4,2")).toBe(true)
    expect(edge.has("4,2")).toBe(false)
  })

  it("fractional exponent (4.5) sits between ellipse and near-rect in cell count", () => {
    const ellipse = new Set(rasterizeShape("ellipse", "fill", 11, 11, 2)).size
    const squircle = new Set(rasterizeShape("ellipse", "fill", 11, 11, 4.5)).size
    const nearRect = new Set(rasterizeShape("ellipse", "fill", 11, 11, 8)).size
    expect(squircle).toBeGreaterThan(ellipse)
    expect(squircle).toBeLessThanOrEqual(nearRect)
  })
})

describe("buildShapeClipboard", () => {
  it("wraps cells as a single-layer/single-group ClipboardData with bbox bounds", () => {
    const clip = buildShapeClipboard("rectangle", "fill", 3, 2, 8, 5, "g1")
    expect(clip.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 })
    expect(clip.layers).toHaveLength(1)
    expect(clip.layers[0].layerId).toBe(5)
    expect(clip.layers[0].groups).toHaveLength(1)
    expect(clip.layers[0].groups[0].id).toBe("g1")
    expect(clip.layers[0].groups[0].points.sort()).toEqual(
      ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1"].sort(),
    )
  })
})
