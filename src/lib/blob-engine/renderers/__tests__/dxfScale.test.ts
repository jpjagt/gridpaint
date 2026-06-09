import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { generateLayerDxf } from "@/lib/blob-engine/renderers/DxfRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function maxCoord(dxf: string): number {
  const lines = dxf.split(/\r?\n/)
  let max = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i].trim()
    if (code === "10" || code === "20") {
      const v = Math.abs(parseFloat(lines[i + 1]))
      if (!Number.isNaN(v)) max = Math.max(max, v)
    }
  }
  return max
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
  it("doubles output extent for a 2x layer vs 1x", () => {
    const base = maxCoord(render())
    const doubled = maxCoord(render({ num: 2, den: 1 }))
    expect(base).toBeGreaterThan(0)
    expect(doubled).toBeCloseTo(base * 2, 3)
  })
  it("halves output extent for a 1/2 layer vs 1x", () => {
    const base = maxCoord(render())
    const halved = maxCoord(render({ num: 1, den: 2 }))
    expect(halved).toBeCloseTo(base / 2, 3)
  })
})
