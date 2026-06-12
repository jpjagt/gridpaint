/**
 * Tests for the 3D extrusion pipeline (classifySvgLoops + createExtrudeGeometryFromSvg).
 *
 * Loop classification is winding-based (see SvgPathRenderer's ORIENTATION
 * GUARANTEE): outer loops are CW/positive-area, holes CCW/negative. These
 * tests assert three semantic invariants rather than raw buffers:
 *
 *   1. topology   — shape & hole counts from classifySvgLoops
 *   2. footprint  — mesh volume ÷ depth == even-odd fill area oracle
 *   3. manifold   — zero non-manifold edges (catches "webbing" from holes
 *                   assigned to the wrong contour)
 *
 * Key regressions covered:
 *  - ring with a disconnected island inside its hole (user bug report): the
 *    old SVGLoader scanline classified the island as a second hole of the
 *    ring, inverting its fill.
 *  - disconnected shapes tangent at a single subgrid point ( ")(" ): the old
 *    classifier could ray-cast from a loop start point lying exactly on the
 *    other loop, flipping parity.
 *  - complex layer with non-convex inner voids + cutouts (chain-gear shape).
 */

import { describe, it, expect } from "vitest"
import { generateLayerSvgContent } from "@/lib/export/svgUtils"
import {
  classifySvgLoops,
  createExtrudeGeometryFromSvg,
} from "@/lib/threejs/pathToShape"
import {
  svgLoopPolygons,
  evenOddFillArea,
  meshVolume,
  nonManifoldEdgeCount,
} from "@/lib/test-utils/geometryTestUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { PointModifications } from "@/types/gridpaint"

const GRID_SIZE = 50
const BORDER_WIDTH = 2

function svgForLayer(layer: GridLayer, includeCutouts = true): string {
  const content = generateLayerSvgContent(
    layer,
    GRID_SIZE,
    BORDER_WIDTH,
    { strokeColor: "#000", strokeWidth: 0.1, fillColor: "transparent", includeCutouts },
    1.0,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50">
${content}
</svg>`
}

/**
 * Assert the full set of semantic invariants for a layer and return the
 * classified shapes (sorted by ascending area) for topology assertions.
 */
function checkLayer(layer: GridLayer, depth = 1, includeCutouts = true) {
  const svg = svgForLayer(layer, includeCutouts)

  const shapes = classifySvgLoops(svg)
  expect(shapes).not.toBeNull()

  const geo = createExtrudeGeometryFromSvg(svg, {}, depth)
  expect(geo).not.toBeNull()
  expect(geo!.attributes.position.count).toBeGreaterThan(0)

  // Watertight 2-manifold: catches holes attached to the wrong contour
  expect(nonManifoldEdgeCount(geo!)).toBe(0)

  // Footprint area matches ground-truth even-odd fill of the loops
  const expectedArea = evenOddFillArea(svgLoopPolygons(svg))
  const actualArea = meshVolume(geo!) / depth
  expect(actualArea).toBeGreaterThan(0)
  expect(Math.abs(actualArea - expectedArea) / expectedArea).toBeLessThan(0.01)

  return { shapes: shapes!, geo: geo!, area: actualArea }
}

describe("classifySvgLoops + createExtrudeGeometryFromSvg", () => {
  it("ring with island inside its hole (user bug report) → 2 solids, ring has 1 hole", () => {
    const { shapes } = checkLayer({
      id: 3, isVisible: true, renderStyle: "default",
      groups: [{
        id: "default",
        points: new Set([
          "1,4","1,5","1,6","1,7","1,8","1,9","1,10","2,4","2,10","3,1","3,2","3,3","3,4","3,5","3,7","3,8","3,9","3,10","4,1","4,10","5,1","5,10","6,1","6,5","6,6","6,10","7,1","7,3","7,4","7,5","7,10","8,1","8,10","9,2","9,3","9,4","9,5","9,6","9,7","9,8","9,9","9,10",
        ]),
      }],
    })

    expect(shapes).toHaveLength(2)
    // shapes are sorted by ascending area: [island, ring]
    expect(shapes[0].holes).toHaveLength(0) // island is solid
    expect(shapes[1].holes).toHaveLength(1) // ring has its central hole
  })

  it("dot inside a C's mouth (tangent at one point) → 2 solids, no holes", () => {
    const { shapes } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: new Set(["0,0","0,1","0,2","1,0","1,2","2,0","2,2"]) },
        { id: "group-2", points: new Set(["2,1"]) },
      ],
    })

    expect(shapes).toHaveLength(2)
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true)
  })

  it("two tangent circles ')(' → 2 solids, no holes", () => {
    const { shapes, area } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: new Set(["1,1"]) },
        { id: "group-2", points: new Set(["2,1"]) },
      ],
    })

    expect(shapes).toHaveLength(2)
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true)
    // two circles of r=0.5 → π/2 (flattened-arc tolerance handled by oracle)
    expect(area).toBeCloseTo(Math.PI / 2, 1)
  })

  it("two C-shapes with tangent arms enclosing a void → fill stays correct", () => {
    const { shapes } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: new Set(["0,0","0,1","0,2","1,0","1,2"]) },
        { id: "group-2", points: new Set(["2,0","2,2","3,0","3,1","3,2"]) },
      ],
    })

    // The two C's touch at TWO tangency points, enclosing a void. The
    // face-tracer may emit this as either 2 separate solids (void open at
    // measure-zero pinches) or 1 union solid with the void as a hole — both
    // describe the identical filled region (checkLayer asserts area +
    // watertightness). Accept either topology.
    const totalHoles = shapes.reduce((n, s) => n + s.holes.length, 0)
    expect(shapes.length + totalHoles).toBe(2)
  })

  it("simple donut → 1 solid with 1 hole", () => {
    const { shapes } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{
        id: "default",
        points: new Set(["5,5","6,5","7,5","5,6","7,6","5,7","6,7","7,7"]),
      }],
    })

    expect(shapes).toHaveLength(1)
    expect(shapes[0].holes).toHaveLength(1)
  })

  it("two disconnected blobs → 2 solids, no holes", () => {
    const { shapes } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1","2,1","10,10","11,10"]) }],
    })

    expect(shapes).toHaveLength(2)
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true)
  })

  it("donut + disconnected island inside hole + dot inside ring (nesting depth 3)", () => {
    // 5×5 ring, empty interior except a single dot at the centre
    const ring = new Set<string>()
    for (let x = 0; x <= 4; x++) for (let y = 0; y <= 4; y++) {
      if (x === 0 || x === 4 || y === 0 || y === 4) ring.add(`${x},${y}`)
    }
    const { shapes } = checkLayer({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: ring },
        { id: "group-2", points: new Set(["2,2"]) },
      ],
    })

    expect(shapes).toHaveLength(2)
    const [dot, ringShape] = shapes // ascending area
    expect(dot.holes).toHaveLength(0)
    expect(ringShape.holes).toHaveLength(1)
  })

  it("complex chain-gear layer with non-convex voids and cutouts", () => {
    const layer: GridLayer = {
      id: 2, isVisible: true, renderStyle: "default",
      groups: [
        {
          id: "default",
          points: new Set([
            "130,15","130,16","130,17","131,14","131,16","131,18",
            "132,14","132,18","133,15","133,17","134,14","134,18",
            "135,15","135,17","136,14","136,18","137,14","137,16","137,18",
            "138,15","138,17","139,16",
          ]),
        },
        { id: "group-2", points: new Set(["131,16","132,16","133,16","134,16"]) },
      ],
      pointModifications: new Map<string, PointModifications>([
        ["130,15", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
        ["130,17", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
      ]),
    }

    const withCutouts = checkLayer(layer, 1, true)
    const withoutCutouts = checkLayer(layer, 1, false)

    // Cutout circles must subtract material
    expect(withCutouts.area).toBeLessThan(withoutCutouts.area)
  })

  it("layer scale (g transform) is applied to the extruded footprint", () => {
    const base: GridLayer = {
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1","2,1","1,2","2,2"]) }],
    }
    const unscaledArea = checkLayer(base).area

    const svg = svgForLayer({ ...base, scale: { num: 1, den: 2 } })
    expect(svg).toContain('transform="scale(0.5)"')
    const geo = createExtrudeGeometryFromSvg(svg, {}, 1)!
    // uniform scale 0.5 → footprint area × 0.25
    expect(meshVolume(geo)).toBeCloseTo(unscaledArea * 0.25, 2)
  })

  it("volume scales linearly with extrusion depth", () => {
    const layer: GridLayer = {
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1","2,1","1,2","2,2"]) }],
    }
    const a1 = checkLayer(layer, 1).area
    const a2 = checkLayer(layer, 2.5).area
    expect(a2).toBeCloseTo(a1, 5)
  })

  it("returns null for empty SVG", () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
</svg>`
    expect(classifySvgLoops(svg)).toBeNull()
    expect(createExtrudeGeometryFromSvg(svg, {}, 1)).toBeNull()
  })
})
