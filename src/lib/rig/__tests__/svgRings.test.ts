// @vitest-environment node
import { describe, it, expect } from "vitest"
import { pathRings } from "@/lib/rig/svgRings"
import { ringArea } from "@/lib/rig/clip"

describe("pathRings", () => {
  it("flattens a circle made of quarter arcs", () => {
    const [ring] = pathRings(
      "M 3.5 3 A 0.5 0.5 0 0 1 3 3.5 A 0.5 0.5 0 0 1 2.5 3 A 0.5 0.5 0 0 1 3 2.5 A 0.5 0.5 0 0 1 3.5 3 Z",
    )
    expect(ringArea(ring)).toBeCloseTo(Math.PI / 4, 2)
    for (const p of ring) expect(Math.hypot(p.x - 3, p.y - 3)).toBeCloseTo(0.5, 6)
  })

  it("keeps hole orientation (sweep 0 = counter-clockwise on screen)", () => {
    const [hole] = pathRings("M 1 0 A 0.5 0.5 0 0 0 0 0 A 0.5 0.5 0 0 0 1 0 Z")
    expect(ringArea(hole)).toBeCloseTo(-Math.PI / 4, 2)
  })
})
