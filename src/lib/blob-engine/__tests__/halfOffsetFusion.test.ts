import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function renderLayerSvg(layer: GridLayer): string {
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

describe("half-offset fusion", () => {
  it("produces a valid path for a half-offset point on the 0.5 subgrid", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "h", points: new Set(["3,3"]), offsetPhase: "half" }],
    }
    const svg = renderLayerSvg(layer)
    const nums = Array.from(svg.matchAll(/-?\d+(\.\d+)?/g)).map((m) => parseFloat(m[0]))
    expect(nums.length).toBeGreaterThan(0)
    for (const n of nums) {
      expect(Number.isNaN(n)).toBe(false)
      expect(Math.abs((n * 2) - Math.round(n * 2))).toBeLessThan(1e-9)
    }
  })

  it("renders a normal point and a half-offset point together without error", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [
        { id: "n", points: new Set(["4,4"]), offsetPhase: "normal" },
        { id: "h", points: new Set(["3,3"]), offsetPhase: "half" },
      ],
    }
    const svg = renderLayerSvg(layer)
    const subpaths = (svg.match(/M /g) || []).length
    expect(subpaths).toBeGreaterThanOrEqual(1)
    expect(svg).toContain("<path")
  })
})
