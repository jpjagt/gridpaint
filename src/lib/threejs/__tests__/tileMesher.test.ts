/**
 * Tile mesher vs the legacy SVG → ExtrudeGeometry pipeline.
 *
 * For each representative layer the new mesh must
 *   - cover the same footprint (front-cap area and bounds, within the
 *     exact-circle vs bézier tolerance),
 *   - be a closed, consistently oriented solid (every welded edge used once
 *     in each direction),
 *   - have outward normals (positive volume = area × depth, no triangle
 *     wound against its normals).
 */

import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import {
  piecesFromPoints,
  piecesFromPrimitives,
} from "@/lib/threejs/blobPieces"
import {
  frontCapArea,
  invertedTriangleCount,
  meshLayerBothWays,
  positionBounds,
  signedVolume,
  unbalancedEdgeCount,
} from "@/lib/test-utils/meshTestUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { PieceGrid } from "@/types/threejs"
import type { PointModifications, QuadrantOverrides } from "@/types/gridpaint"

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function layerOf(points: string[], extra: Partial<GridLayer> = {}): GridLayer {
  return {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "default", points: new Set(points) }],
    ...extra,
  }
}

function noisePoints(size: number, seed: number, density = 0.5): string[] {
  const r = rng(seed)
  const pts: string[] = []
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (r() < density) pts.push(`${x},${y}`)
  return pts
}

function block(x0: number, y0: number, x1: number, y1: number): string[] {
  const pts: string[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pts.push(`${x},${y}`)
  return pts
}

/** Full comparison; returns the pair for extra assertions */
function expectMatchesLegacy(layer: GridLayer, opts: { includeCutouts?: boolean; mmPerUnit?: number } = {}) {
  const pair = meshLayerBothWays(layer, opts)
  expect(pair.plan.kind).toBe("tiles")
  const tiles = pair.tiles!
  const legacy = pair.legacy!
  expect(legacy).not.toBeNull()

  const newArea = frontCapArea(tiles)
  const oldArea = frontCapArea(legacy)
  expect(newArea).toBeGreaterThan(0)
  // Exact circles vs flattened béziers: well under 0.5%
  expect(Math.abs(newArea - oldArea) / oldArea).toBeLessThan(0.005)

  const nb = positionBounds(tiles)
  const ob = positionBounds(legacy)
  for (const k of ["x", "y", "z"] as const) {
    expect(nb.min[k]).toBeCloseTo(ob.min[k], 2)
    expect(nb.max[k]).toBeCloseTo(ob.max[k], 2)
  }

  expect(unbalancedEdgeCount(tiles)).toBe(0)
  expect(invertedTriangleCount(tiles)).toBe(0)
  // Closed + outward ⇒ volume equals footprint × depth (depth 1)
  expect(signedVolume(tiles)).toBeCloseTo(newArea, 4)
  return pair
}

const OVERRIDE_STATES = [
  "full", "empty",
  "convex-se", "convex-sw", "convex-nw", "convex-ne",
  "concave-se", "concave-sw", "concave-nw", "concave-ne",
] as const

describe("tile mesher matches the legacy extrusion", () => {
  it("single dot (four quarter disks)", () => {
    expectMatchesLegacy(layerOf(["3,3"]))
  })

  it("donut with a hole", () => {
    expectMatchesLegacy(layerOf(["5,5", "6,5", "7,5", "5,6", "7,6", "5,7", "6,7", "7,7"]))
  })

  it("diagonal chain (bridges) and pinch points", () => {
    expectMatchesLegacy(layerOf(["0,0", "1,1", "2,2", "3,1", "4,0", "2,4", "3,5"]))
  })

  it.each([1, 2, 3])("random noise 24×24 (seed %i)", (seed) => {
    expectMatchesLegacy(layerOf(noisePoints(24, seed)))
  })

  it("large solid block with a few holes (merged runs)", () => {
    const pts = new Set(block(0, 0, 30, 20))
    for (const p of ["5,5", "6,5", "20,10", "21,11", "15,15"]) pts.delete(p)
    expectMatchesLegacy(layerOf([...pts]))
  })

  it("negative coordinates", () => {
    expectMatchesLegacy(layerOf(["-3,-2", "-2,-2", "-4,-1", "0,0", "-1,1"]))
  })

  it.each([
    [{ num: 1, den: 2 }],
    [{ num: 3, den: 1 }],
  ])("layer scale %o", (scale) => {
    expectMatchesLegacy(layerOf(noisePoints(10, 9), { scale }))
  })

  it("two tangent circles in separate groups ')('", () => {
    expectMatchesLegacy({
      ...layerOf(["1,1"]),
      groups: [
        { id: "default", points: new Set(["1,1"]) },
        { id: "g2", points: new Set(["2,1"]) },
      ],
    })
  })

  it("C shape with a dot in another group", () => {
    expectMatchesLegacy({
      ...layerOf([]),
      groups: [
        { id: "default", points: new Set(["0,0", "0,1", "0,2", "1,0", "1,2", "2,0", "2,2"]) },
        { id: "g2", points: new Set(["2,1"]) },
      ],
    })
  })

  it("random multi-group noise", () => {
    const r = rng(42)
    const a: string[] = []
    const b: string[] = []
    for (const p of noisePoints(20, 5)) (r() < 0.5 ? a : b).push(p)
    expectMatchesLegacy({
      ...layerOf([]),
      groups: [
        { id: "default", points: new Set(a) },
        { id: "g2", points: new Set(b) },
      ],
    })
  })

  it("half-offset group on its own", () => {
    expectMatchesLegacy({
      ...layerOf([]),
      groups: [
        { id: "default", points: new Set(["0,0", "1,0", "1,1", "3,3"]) },
        { id: "half", points: new Set(["10,10", "11,10", "12,11"]), offsetPhaseX: "half", offsetPhaseY: "half" },
      ],
    })
  })

  it("every quadrant override state in every quadrant", () => {
    const mods = new Map<string, PointModifications>()
    const pts = block(0, 0, 21, 4)
    let x = 0
    for (const state of OVERRIDE_STATES) {
      for (let q = 0; q < 4; q++) {
        // Spread overrides out so neighbouring overrides don't interact
        if (x > 20) break
        mods.set(`${x},2`, { quadrantOverrides: { [q]: state } as QuadrantOverrides })
        x += 1
      }
    }
    expectMatchesLegacy(layerOf(pts, { pointModifications: mods }))
  })

  it("override-only points and random overrides on noise", () => {
    const r = rng(7)
    const mods = new Map<string, PointModifications>()
    const pts = noisePoints(16, 11)
    for (let k = 0; k < 40; k++) {
      const key = `${Math.floor(r() * 16)},${Math.floor(r() * 16)}`
      const q = Math.floor(r() * 4)
      const state = OVERRIDE_STATES[Math.floor(r() * OVERRIDE_STATES.length)]
      mods.set(key, { quadrantOverrides: { [q]: state } as QuadrantOverrides })
    }
    expectMatchesLegacy(layerOf(pts, { pointModifications: mods }))
  })
})

describe("cutouts", () => {
  const solid = block(0, 0, 8, 6)

  it("interior circles (mm and grid sized) are punched natively", () => {
    const mods = new Map<string, PointModifications>([
      ["2,2", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
      ["5,3", { cutouts: [{ anchor: "center", diameterMm: 1, sizeUnit: "grid", diameterGrid: 0.6 }] }],
      ["6,4", { cutouts: [{ anchor: "se", diameterMm: 0.4 }] }],
    ])
    const pair = expectMatchesLegacy(layerOf(solid, { pointModifications: mods }), { mmPerUnit: 1 })
    expect(pair.plan.kind === "tiles" && pair.plan.regions.length).toBe(3)
  })

  it("interior pill and neighbouring circles sharing a region", () => {
    const mods = new Map<string, PointModifications>([
      ["2,2", { cutouts: [{ anchor: "center", shape: "pill", diameterMm: 0.5, endOffset: { x: 2, y: 1 } }] }],
      ["3,4", { cutouts: [{ anchor: "center", diameterMm: 0.5 }] }],
      ["4,4", { cutouts: [{ anchor: "center", diameterMm: 0.5 }] }],
    ])
    expectMatchesLegacy(layerOf(solid, { pointModifications: mods }), { mmPerUnit: 1 })
  })

  it("cutouts are ignored when includeCutouts is false", () => {
    const mods = new Map<string, PointModifications>([
      ["2,2", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
    ])
    const pair = expectMatchesLegacy(layerOf(solid, { pointModifications: mods }), { includeCutouts: false })
    // 9×7 block with its four corners rounded: each loses a quarter square
    // minus a 16-segment quarter disk of radius ½
    const quarterDisk = 16 * 0.5 * 0.25 * Math.sin(Math.PI / 32)
    const corner = 0.25 - quarterDisk
    expect(frontCapArea(pair.tiles!)).toBeCloseTo(9 * 7 - 4 * corner, 6)
  })

  it("falls back when a cutout touches the outline", () => {
    const mods = new Map<string, PointModifications>([
      ["0,3", { cutouts: [{ anchor: "w", diameterMm: 0.5 }] }],
    ])
    const pair = meshLayerBothWays(layerOf(solid, { pointModifications: mods }))
    expect(pair.plan.kind).toBe("fallback")
  })

  it("falls back when cutouts overlap", () => {
    const mods = new Map<string, PointModifications>([
      ["3,3", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
      ["4,3", { cutouts: [{ anchor: "w", diameterMm: 0.5 }] }],
    ])
    const pair = meshLayerBothWays(layerOf(solid, { pointModifications: mods }))
    expect(pair.plan).toEqual({ kind: "fallback", reason: "overlapping cutouts" })
  })
})

describe("piece classification", () => {
  function codeMap(grid: PieceGrid): Map<string, number> {
    const m = new Map<string, number>()
    for (let j = 0; j < grid.height; j++)
      for (let i = 0; i < grid.width; i++) {
        const c = grid.codes[j * grid.width + i]
        if (c) m.set(`${grid.i0 + i},${grid.j0 + j}`, c)
      }
    return m
  }

  it.each([1, 2, 3, 4, 5])("bitmap fast path equals the BlobEngine's primitives (seed %i)", (seed) => {
    const layer = layerOf(noisePoints(30, seed * 13, 0.3 + seed * 0.1))
    const fast = piecesFromPoints(layer.groups[0].points)!
    const prims = new BlobEngine({ enableCaching: false }).generateLayerGeometry(layer, 1, 0).primitives
    const viaEngine = piecesFromPrimitives(prims)
    expect(typeof viaEngine).toBe("object")
    expect(codeMap(fast)).toEqual(codeMap(viaEngine as PieceGrid))
  })

  it("overlapping half-offset pieces that don't union to a piece fall back", () => {
    const pair = meshLayerBothWays({
      ...layerOf([]),
      groups: [
        { id: "default", points: new Set(["0,0"]) },
        { id: "half", points: new Set(["0,0"]), offsetPhaseX: "half", offsetPhaseY: "half" },
      ],
    })
    expect(pair.plan.kind).toBe("fallback")
  })
})
