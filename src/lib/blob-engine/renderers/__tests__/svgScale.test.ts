import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function render(scale?: { num: number; den: number }): string {
  const layer: GridLayer = {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["0,0", "1,0"]) }],
    scale,
  }
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, 10, 0)
  const renderer = new SvgPathRenderer(false)
  return renderer.renderLayer(
    geometry,
    { fillColor: "#000" },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    layer,
  )
}

describe("SvgPathRenderer scale", () => {
  it("emits no transform when scale is absent or 1/1", () => {
    expect(render()).not.toContain("transform=")
    expect(render({ num: 1, den: 1 })).not.toContain("transform=")
  })
  it("wraps output in a scale transform for a 2x layer", () => {
    expect(render({ num: 2, den: 1 })).toContain('transform="scale(2)"')
  })
  it("wraps output in a scale transform for a 1/2 layer", () => {
    expect(render({ num: 1, den: 2 })).toContain('transform="scale(0.5)"')
  })
})
