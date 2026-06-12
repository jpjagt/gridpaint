/**
 * Winding-orientation invariant tests.
 *
 * The SvgPathRenderer guarantees that every primitive perimeter — and
 * therefore every stitched boundary loop — is oriented with the filled region
 * on the RIGHT of the direction of travel (clockwise in y-down screen space).
 *
 * This makes loop winding a deterministic outer-vs-hole signal:
 *   outer boundary → positive shoelace area (in SVG coords)
 *   hole boundary  → negative shoelace area
 *
 * Downstream classification (createPathGroups, STL extrusion) relies on this
 * invariant, so these tests are the early-warning line for any change to
 * primitive edge emission, deduplication, or stitching.
 */

import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import {
  SvgPathRenderer,
  primitiveToEdges,
  type Edge,
  type Pt,
} from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { BlobPrimitive, GridLayer, Quadrant } from "@/lib/blob-engine/types"
import type { PointModifications } from "@/types/gridpaint"

const GRID_SIZE = 50
const BORDER_WIDTH = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an edge loop to a polygon (in 2× subgrid integer coords), sampling
 * arcs with `samplesPerArc` intermediate points.
 */
function polygonize(edges: Edge[], samplesPerArc = 8): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (const edge of edges) {
    points.push([edge.a.x2, edge.a.y2])
    if (edge.kind === "arc") {
      const { a, b, center: c, sweep } = edge
      const a0 = Math.atan2(a.y2 - c.y2, a.x2 - c.x2)
      const a1 = Math.atan2(b.y2 - c.y2, b.x2 - c.x2)
      // Minor arc: |delta| < π. sweep=1 (screen CW) means increasing raw angle.
      let delta = a1 - a0
      while (delta <= -Math.PI) delta += 2 * Math.PI
      while (delta > Math.PI) delta -= 2 * Math.PI
      // delta's sign must match the sweep flag for a minor arc
      expect(delta === 0 ? null : delta > 0 ? 1 : 0).toBe(sweep)
      const r = Math.hypot(a.x2 - c.x2, a.y2 - c.y2)
      for (let i = 1; i <= samplesPerArc; i++) {
        const ang = a0 + (delta * i) / (samplesPerArc + 1)
        points.push([c.x2 + r * Math.cos(ang), c.y2 + r * Math.sin(ang)])
      }
    }
  }
  return points
}

/** Shoelace signed area. Positive = clockwise in y-down screen coords. */
function shoelace(points: Array<[number, number]>): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

function loopIsClosed(edges: Edge[]): boolean {
  if (edges.length === 0) return false
  const eq = (p: Pt, q: Pt) => p.x2 === q.x2 && p.y2 === q.y2
  for (let i = 0; i < edges.length; i++) {
    if (!eq(edges[i].b, edges[(i + 1) % edges.length].a)) return false
  }
  return true
}

function renderLayerDebug(layer: GridLayer) {
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, GRID_SIZE, BORDER_WIDTH)
  const renderer = new SvgPathRenderer(true)
  renderer.renderLayer(
    geometry,
    { strokeColor: "#000", strokeWidth: 0.5, fillColor: "none" },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    layer,
  )
  return renderer.getLastDebugInfo()!
}

/** Signed areas of all stitched loops of a layer, sorted descending. */
function loopAreas(layer: GridLayer): number[] {
  const debug = renderLayerDebug(layer)
  for (const loop of debug.stitchedPaths) {
    expect(loopIsClosed(loop)).toBe(true)
  }
  return debug.stitchedPaths
    .map((loop) => shoelace(polygonize(loop)))
    .sort((a, b) => b - a)
}

// ---------------------------------------------------------------------------
// Per-primitive invariant: every emitted perimeter is CW (positive shoelace)
// ---------------------------------------------------------------------------

describe("primitiveToEdges winding invariant", () => {
  const types = ["rectangle", "roundedCorner", "diagonalBridge"] as const

  for (const type of types) {
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      for (let relOffset = 0; relOffset < 4; relOffset++) {
        // rectangle has no renderQuadrant variants
        if (type === "rectangle" && relOffset > 0) continue

        it(`${type} q${quadrant} relOffset=${relOffset} is a closed CW loop`, () => {
          const primitive: BlobPrimitive = {
            type,
            center: { x: 5, y: 5 },
            quadrant: quadrant as Quadrant,
            renderQuadrant: (((quadrant + relOffset) % 4) as Quadrant),
            size: 1,
            layerId: 1,
            curveType: "none",
          }
          const edges = primitiveToEdges(primitive)
          expect(edges.length).toBeGreaterThanOrEqual(3)
          expect(loopIsClosed(edges)).toBe(true)
          expect(shoelace(polygonize(edges))).toBeGreaterThan(0)
        })
      }
    }
  }
})

// ---------------------------------------------------------------------------
// Stitched-loop invariant: outers positive, holes negative
// ---------------------------------------------------------------------------

describe("stitched loop winding", () => {
  it("solid circle → 1 positive loop", () => {
    const areas = loopAreas({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1"]) }],
    })
    expect(areas).toHaveLength(1)
    expect(areas[0]).toBeGreaterThan(0)
  })

  it("two tangent circles (different groups) → 2 positive loops", () => {
    const areas = loopAreas({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: new Set(["1,1"]) },
        { id: "group-2", points: new Set(["2,1"]) },
      ],
    })
    expect(areas).toHaveLength(2)
    expect(areas.every((a) => a > 0)).toBe(true)
  })

  it("donut → 1 positive outer + 1 negative hole", () => {
    const areas = loopAreas({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{
        id: "default",
        points: new Set(["5,5", "6,5", "7,5", "5,6", "7,6", "5,7", "6,7", "7,7"]),
      }],
    })
    expect(areas).toHaveLength(2)
    expect(areas[0]).toBeGreaterThan(0)
    expect(areas[1]).toBeLessThan(0)
  })

  it("pinch-point hole (plus with empty NE quadrant) → outer positive, hole negative", () => {
    const areas = loopAreas({
      id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: new Set(["0,1", "1,0", "1,1", "1,2", "2,1"]) }],
      pointModifications: new Map<string, PointModifications>([
        ["1,1", { quadrantOverrides: { 3: "empty" } }],
      ]),
    })
    expect(areas).toHaveLength(2)
    expect(areas[0]).toBeGreaterThan(0)
    expect(areas[1]).toBeLessThan(0)
  })

  it("double pinch point (ring + bar) → 1 positive outer + 3 negative voids", () => {
    const areas = loopAreas({
      id: 2, isVisible: true, renderStyle: "default",
      groups: [
        { id: "default", points: new Set(["0,1","0,2","0,3","1,0","1,2","1,4","2,0","2,4","3,1","3,3","4,0","4,4","5,1","5,3","6,2"]) },
        { id: "group-2", points: new Set(["1,2","2,2","3,2","4,2"]) },
      ],
    })
    expect(areas).toHaveLength(4)
    expect(areas.filter((a) => a > 0)).toHaveLength(1)
    expect(areas.filter((a) => a < 0)).toHaveLength(3)
  })

  it("ring with island inside its hole (user bug report) → 2 positive + 1 negative", () => {
    const areas = loopAreas({
      id: 3, isVisible: true, renderStyle: "default",
      groups: [{
        id: "default",
        points: new Set([
          "1,4","1,5","1,6","1,7","1,8","1,9","1,10","2,4","2,10","3,1","3,2","3,3","3,4","3,5","3,7","3,8","3,9","3,10","4,1","4,10","5,1","5,10","6,1","6,5","6,6","6,10","7,1","7,3","7,4","7,5","7,10","8,1","8,10","9,2","9,3","9,4","9,5","9,6","9,7","9,8","9,9","9,10",
        ]),
      }],
    })
    expect(areas).toHaveLength(3)
    expect(areas.filter((a) => a > 0)).toHaveLength(2)
    expect(areas.filter((a) => a < 0)).toHaveLength(1)
    // The ring outer is the largest loop; the hole is larger in magnitude
    // than the island (the island sits inside the hole).
    const hole = areas[2]
    const island = areas[1]
    expect(Math.abs(hole)).toBeGreaterThan(island)
  })
})
