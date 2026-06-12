import { describe, it, expect, beforeEach } from "vitest"
import { getLayerFillColor, interpolateHsl } from "@/lib/gridpaint/layerColors"

describe("layerColors", () => {
  beforeEach(() => {
    // jsdom doesn't load globals.css; set the anchor tokens manually.
    document.documentElement.style.setProperty(
      "--canvas-layer-lightest",
      "0 0% 90%",
    )
    document.documentElement.style.setProperty(
      "--canvas-layer-darkest",
      "0 0% 30%",
    )
  })

  it("interpolateHsl blends triples linearly", () => {
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 0)).toBe("hsl(0 0% 90%)")
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 1)).toBe("hsl(0 0% 30%)")
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 0.5)).toBe("hsl(0 0% 60%)")
  })

  it("min id is lightest, max id is darkest", () => {
    const range = { min: 1, max: 6 }
    expect(getLayerFillColor(1, range)).toBe("hsl(0 0% 90%)")
    expect(getLayerFillColor(6, range)).toBe("hsl(0 0% 30%)")
  })

  it("interpolates across negative ranges", () => {
    const range = { min: -2, max: 2 }
    // id 0 is the midpoint of -2..2 → 60% lightness
    expect(getLayerFillColor(0, range)).toBe("hsl(0 0% 60%)")
  })

  it("single-element range returns the lightest anchor", () => {
    expect(getLayerFillColor(3, { min: 3, max: 3 })).toBe("hsl(0 0% 90%)")
  })
})
