// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as THREE from "three"
import { analyzeRig } from "@/lib/rig/analyze"
import { buildRigParts } from "@/lib/rig/mesh"
import { build3mf } from "@/lib/rig/exportRig"
import { unzipSync, strFromU8 } from "fflate"
import type { Layer } from "@/stores/drawingStores"
import type { PrintSetup } from "@/types/rig"

const L = (id: number, pts: string[]): Layer => ({
  id,
  isVisible: true,
  renderStyle: "default",
  groups: [{ id: `g${id}`, points: new Set(pts) }],
})
const plus = ["2,0", "2,1", "0,2", "1,2", "2,2", "3,2", "4,2", "2,3", "2,4"]
const setup: PrintSetup = {
  clearance: 0.2,
  basePlateThickness: 1.2,
  minWall: 1,
  stencilThickness: 0.6,
  glueDiameter: 1.5,
  glueMargin: 0.5,
  glueMarkers: true,
}
const base = {
  rect: { id: "r", minX: 0, minY: 0, maxX: 4, maxY: 4, quantity: 1 },
  layers: [L(1, plus), L(2, plus)],
  gridSize: 50,
  borderWidth: 0,
  mmPerUnit: 5,
  thickness: 1,
  pillars: [] as { x: number; y: number }[],
  reverse: false,
  glueSpots: [] as { layerId: number; x: number; y: number }[],
  setup,
}

describe("buildRigParts", () => {
  it("builds a rig and a stencil, and packs them in a 3MF", () => {
    const first = analyzeRig(base)
    const a = analyzeRig({
      ...base,
      pillars: first.suggestedPillars,
      glueSpots: first.suggestedGlueSpots,
    })
    const parts = buildRigParts(a, setup, false)
    expect(parts.map((p) => p.name)).toEqual(["rig", "glue stencil 2 (then 1)"])

    const rig = parts[0].geometry
    rig.computeBoundingBox()
    const bb = rig.boundingBox!
    expect(bb.min.z).toBeCloseTo(0)
    // Pillars hold both 1 mm layers and add a 0.6 mm cap
    expect(bb.max.z).toBeCloseTo(1.2 + 2 + 0.6, 3)

    const stencil = parts[1].geometry
    stencil.computeBoundingBox()
    expect(stencil.boundingBox!.max.z).toBeCloseTo(0.6)
    expect(stencil.boundingBox!.min.x).toBeGreaterThan(bb.max.x)

    const files = unzipSync(build3mf(parts))
    const model = strFromU8(files["3D/3dmodel.model"])
    expect(model).toContain('name="rig"')
    expect((model.match(/<object /g) ?? []).length).toBe(2)
    expect(files["[Content_Types].xml"]).toBeDefined()
  })

  it("cuts glue marker slots into pillars next to glue spots", () => {
    const first = analyzeRig(base)
    const a = analyzeRig({
      ...base,
      pillars: first.suggestedPillars,
      glueSpots: first.suggestedGlueSpots,
    })
    const count = (markers: boolean) =>
      buildRigParts(a, { ...setup, glueMarkers: markers }, false)[0].geometry.getIndex()!.count
    expect(count(true)).toBeGreaterThan(count(false))
  })

  it("mirrors the rig when assembling face down", () => {
    const a = analyzeRig({ ...base, pillars: [{ x: 5, y: 2 }] })
    const up = buildRigParts(a, setup, false)[0].geometry
    const down = buildRigParts({ ...a }, setup, true)[0].geometry
    up.computeBoundingBox()
    down.computeBoundingBox()
    expect(down.boundingBox!.max.x).toBeCloseTo(-up.boundingBox!.min.x, 3)
    expect(up.getAttribute("position")).toBeInstanceOf(THREE.BufferAttribute)
  })
})
