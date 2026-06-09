import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { generateLayerDxf } from "@/lib/blob-engine/renderers/DxfRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function extents(dxf: string): { x: number; y: number } {
  const lines = dxf.split(/\r?\n/)
  let maxX = 0
  let maxY = 0
  for (let i = 0; i + 1 < lines.length; i++) {
    const code = lines[i].trim()
    if (code === "10") maxX = Math.max(maxX, Math.abs(parseFloat(lines[i + 1])))
    if (code === "20") maxY = Math.max(maxY, Math.abs(parseFloat(lines[i + 1])))
  }
  return { x: maxX, y: maxY }
}

function render(scale?: { num: number; den: number }): string {
  const layer: GridLayer = {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["0,0", "1,0", "0,1", "1,1"]) }],
    scale,
  }
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, 10, 0)
  // mmPerUnit=7: avoids output coordinates equal to DXF group codes 10 or 20,
  // which would confuse the simple maxCoord parser used in these tests.
  return generateLayerDxf(geometry, layer, 7 /* mmPerUnit */)
}

describe("DxfRenderer scale", () => {
  it("doubles output extent on both axes for a 2x layer vs 1x", () => {
    const base = extents(render())
    const doubled = extents(render({ num: 2, den: 1 }))
    expect(base.x).toBeGreaterThan(0)
    expect(base.y).toBeGreaterThan(0)
    expect(doubled.x).toBeCloseTo(base.x * 2, 3)
    expect(doubled.y).toBeCloseTo(base.y * 2, 3)
  })
  it("halves output extent on both axes for a 1/2 layer vs 1x", () => {
    const base = extents(render())
    const halved = extents(render({ num: 1, den: 2 }))
    expect(halved.x).toBeCloseTo(base.x / 2, 3)
    expect(halved.y).toBeCloseTo(base.y / 2, 3)
  })
})
