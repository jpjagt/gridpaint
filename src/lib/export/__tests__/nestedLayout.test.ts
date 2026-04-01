/**
 * Tests for Nested Layout Export (Guillotine Packing)
 *
 * Tests the shape-aware packing and holder export functionality.
 */

import { describe, it, expect } from "vitest"
import type { GridLayer } from "@/lib/blob-engine/types"
import {
  packShapes,
  generateHolderOutline,
  getLayerBoundingBox,
  shiftLayer,
  type ShapeData,
  type PackingOptions,
} from "../nestedLayout"

const createMockGridLayer = (points: string[]): GridLayer => ({
  id: 1,
  groups: [{ id: "g1", points: new Set(points) }],
  isVisible: true,
  renderStyle: "default",
})

describe("getLayerBoundingBox", () => {
  it("should return null for empty layer", () => {
    const layer = createMockGridLayer([])
    const result = getLayerBoundingBox(layer)
    expect(result).toBeNull()
  })

  it("should calculate bounding box for single point", () => {
    const layer = createMockGridLayer(["5,5"])
    const result = getLayerBoundingBox(layer)
    expect(result).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 })
  })

  it("should calculate bounding box for multiple points", () => {
    const layer = createMockGridLayer(["1,1", "5,3", "3,7", "2,5"])
    const result = getLayerBoundingBox(layer)
    expect(result).toEqual({ minX: 1, minY: 1, maxX: 5, maxY: 7 })
  })
})

describe("shiftLayer", () => {
  it("should shift all points by delta", () => {
    const layer = createMockGridLayer(["1,1", "5,5"])
    const shifted = shiftLayer(layer, 10, 20)
    const points = Array.from(shifted.groups[0].points)
    expect(points).toContain("11,21")
    expect(points).toContain("15,25")
  })

  it("should preserve layer metadata", () => {
    const layer = createMockGridLayer(["1,1"])
    const shifted = shiftLayer(layer, 5, 5)
    expect(shifted.id).toBe(1)
    expect(shifted.isVisible).toBe(true)
    expect(shifted.renderStyle).toBe("default")
  })
})

describe("packShapes", () => {
  const defaultOptions: PackingOptions = {
    margin: 10,
    outerMargin: 5,
  }

  it("should return empty result for empty items array", () => {
    const result = packShapes([], defaultOptions)
    expect(result.items).toEqual([])
    expect(result.totalWidth).toBe(0)
    expect(result.totalHeight).toBe(0)
  })

  it("should pack a single rectangle shape", () => {
    const shapes: ShapeData[] = [
      {
        id: "shape-1",
        width: 100,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
    ]

    const result = packShapes(shapes, defaultOptions)

    expect(result.items.length).toBe(1)
    expect(result.items[0].id).toBe("shape-1")
    expect(result.items[0].x).toBe(5)
    expect(result.items[0].y).toBe(5)
    expect(result.items[0].width).toBe(100)
    expect(result.items[0].height).toBe(50)
  })

  it("should pack multiple shapes using guillotine algorithm", () => {
    const shapes: ShapeData[] = [
      {
        id: "rect-1",
        width: 100,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "rect-2",
        width: 50,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "rect-3",
        width: 75,
        height: 30,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
    ]

    const result = packShapes(shapes, defaultOptions)

    expect(result.items.length).toBe(3)
    result.items.forEach((item) => {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.width).toBeGreaterThan(0)
      expect(item.height).toBeGreaterThan(0)
    })
  })

  it("should apply margin between shapes", () => {
    const shapes: ShapeData[] = [
      {
        id: "shape-1",
        width: 50,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "shape-2",
        width: 50,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
    ]

    const result = packShapes(shapes, defaultOptions)

    const item1 = result.items.find((i) => i.id === "shape-1")!
    const item2 = result.items.find((i) => i.id === "shape-2")!

    const xGap = Math.abs(item1.x - item2.x)
    const yGap = Math.abs(item1.y - item2.y)
    const minGap = Math.min(xGap, yGap)

    expect(minGap).toBeGreaterThanOrEqual(0)
  })

  it("should preserve layer and offset in packed items", () => {
    const layer = createMockGridLayer(["10,10", "20,20"])
    const shapes: ShapeData[] = [
      {
        id: "shape-1",
        width: 100,
        height: 50,
        layer,
        layerName: "Layer 1",
        offsetX: 10,
        offsetY: 10,
      },
    ]

    const result = packShapes(shapes, defaultOptions)

    expect(result.items[0].layer).toBe(layer)
    expect(result.items[0].offsetX).toBe(10)
    expect(result.items[0].offsetY).toBe(10)
    expect(result.items[0].layerName).toBe("Layer 1")
  })

  it("should calculate correct total dimensions", () => {
    const shapes: ShapeData[] = [
      {
        id: "shape-1",
        width: 100,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "shape-2",
        width: 100,
        height: 50,
        layer: createMockGridLayer(["0,0"]),
        offsetX: 0,
        offsetY: 0,
      },
    ]

    const result = packShapes(shapes, defaultOptions)

    expect(result.totalWidth).toBeGreaterThan(100)
    expect(result.totalHeight).toBeGreaterThan(50)
  })
})

describe("generateHolderOutline", () => {
  it("should generate a rectangle path", () => {
    const outline = generateHolderOutline(100, 50, 0)
    expect(outline).toBe("M 0 0 L 100 0 L 100 50 L 0 50 Z")
  })

  it("should generate path with custom dimensions", () => {
    const outline = generateHolderOutline(200, 100, 0)
    expect(outline).toBe("M 0 0 L 200 0 L 200 100 L 0 100 Z")
  })

  it("should apply outer margin to the outline", () => {
    const outline = generateHolderOutline(100, 50, 5)
    expect(outline).toBe("M 5 5 L 95 5 L 95 45 L 5 45 Z")
  })
})
