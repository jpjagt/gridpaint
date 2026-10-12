import { describe, expect, it } from "vitest"
import {
  buildDrawingDocument,
  designLayerRange,
  designToGridLayers,
  designToSelection,
  fitView,
  gridLayerToLabLayer,
  labLayerToGridLayer,
  normalizeDesign,
  parseLabInput,
} from "@/lib/lab/designConvert"
import { jewelColor, JEWEL_COLORS, JEWEL_SINGLE } from "@/lib/lab/renderDesign"
import type { LabDesign } from "@/types/lab"

const design: LabDesign = {
  type: "gridlab-design",
  version: 1,
  id: "t1",
  title: "Test",
  recipe: "manual",
  params: { a: 1 },
  seed: 3,
  tags: ["x"],
  width: 4,
  height: 3,
  layers: [
    { id: 3, groups: [{ id: "default", points: ["0,0", "1,0"] }] },
    {
      id: 2,
      groups: [
        { id: "default", points: ["2,1"] },
        { id: "g2", points: ["3,2", "2,1"] },
      ],
    },
  ],
  frames: [
    { label: "t=0", layers: [{ id: 3, groups: [{ id: "default", points: ["0,0"] }] }] },
  ],
}

describe("design <-> GridLayer", () => {
  it("round-trips groups and ids", () => {
    const gl = labLayerToGridLayer(design.layers[1])
    expect(gl.id).toBe(2)
    expect(gl.isVisible).toBe(true)
    expect(gl.groups.map((g) => g.id)).toEqual(["default", "g2"])
    expect(gl.groups[1].points).toBeInstanceOf(Set)
    expect(gridLayerToLabLayer(gl)).toEqual(design.layers[1])
  })

  it("selects frames and layer subsets", () => {
    expect(designToGridLayers(design).map((l) => l.id)).toEqual([3, 2])
    expect(designToGridLayers(design, undefined, [2]).map((l) => l.id)).toEqual([2])
    const f = designToGridLayers(design, 0)
    expect(f).toHaveLength(1)
    expect([...f[0].groups[0].points]).toEqual(["0,0"])
    // out-of-range frame falls back to final layers
    expect(designToGridLayers(design, 9)).toHaveLength(2)
  })
})

describe("selection JSON", () => {
  it("builds a gridpaint-selection payload with layer ids preserved", () => {
    const sel = designToSelection(design, 123)
    expect(sel.type).toBe("gridpaint-selection")
    expect(sel.version).toBe("2.0.0")
    expect(sel.data.timestamp).toBe(123)
    expect(sel.data.bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 2 })
    expect(sel.data.layers.map((l) => l.layerId)).toEqual([2, 3])
    expect(sel.data.layers[0].groups[1]).toEqual({ id: "g2", points: ["3,2", "2,1"] })
  })

  it("parses selections and designs back", () => {
    const sel = designToSelection(design)
    const [fromSel] = parseLabInput(JSON.stringify(sel))
    expect(fromSel.width).toBe(4)
    expect(fromSel.height).toBe(3)
    expect(fromSel.layers.map((l) => l.id)).toEqual([2, 3])
    const [fromDesign] = parseLabInput(JSON.stringify(design), "p")
    expect(fromDesign.id).toBe("p:t1")
    expect(fromDesign.tags).toContain("pasted")
    expect(parseLabInput("not json")).toEqual([])
    expect(parseLabInput('{"type":"other"}')).toEqual([])
  })

  it("normalizes designs whose points start away from the origin", () => {
    const off = normalizeDesign({
      ...design,
      frames: undefined,
      width: 1,
      height: 1,
      layers: [{ id: 1, groups: [{ id: "default", points: ["5,7", "6,9"] }] }],
    })
    expect(off.width).toBe(2)
    expect(off.height).toBe(3)
    expect(off.layers[0].groups[0].points).toEqual(["0,0", "1,2"])
  })
})

describe("document building", () => {
  it("creates a drawing with the design's layers and a centred view", () => {
    const doc = buildDrawingDocument(design, {
      id: "abc",
      now: 1000,
      viewport: { width: 1000, height: 800 },
    })
    expect(doc.id).toBe("abc")
    expect(doc.name).toBe("lab: Test s3")
    expect(doc.layers.map((l) => l.id)).toEqual([2, 3])
    expect(doc.layers[0].groups[1].points.has("3,2")).toBe(true)
    expect(doc.layerRange).toEqual({ min: 1, max: 6 })
    // centre of the design maps to the centre of the viewport
    const cx = (design.width / 2) * doc.gridSize * doc.zoom + doc.panOffset.x
    const cy = (design.height / 2) * doc.gridSize * doc.zoom + doc.panOffset.y
    expect(cx).toBeCloseTo(500)
    expect(cy).toBeCloseTo(400)
  })

  it("widens the layer range for ids outside 1..6 and clamps zoom", () => {
    expect(designLayerRange({ ...design, layers: [{ id: 9, groups: [] }], frames: [] })).toEqual({
      min: 1,
      max: 9,
    })
    expect(fitView({ ...design, width: 1, height: 1 }, 75, { width: 5000, height: 5000 }).zoom).toBe(2)
  })
})

describe("jewel palette", () => {
  it("ranks from the top layer, single layer uses the mid tone", () => {
    expect(jewelColor(0, 1)).toBe(JEWEL_SINGLE)
    expect(jewelColor(0, 3)).toBe(JEWEL_COLORS[0])
    expect(jewelColor(2, 3)).toBe(JEWEL_COLORS[2])
    expect(jewelColor(12, 13)).toBe(JEWEL_COLORS[5])
  })
})
