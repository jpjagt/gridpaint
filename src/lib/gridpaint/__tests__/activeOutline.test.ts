import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { TiledLayerGeometry } from "@/lib/blob-engine/TiledLayerGeometry"
import { GEOMETRY_TILE_CELLS, type GridLayer, type PathSink } from "@/lib/blob-engine/types"
import { boundaryEdges, type Edge } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import { appendEdges, ownedBoundaryEdges } from "@/lib/gridpaint/activeOutline"
import type { PointModifications } from "@/types/gridpaint"

/** Undirected edge identity (stroking doesn't care about direction) */
const edgeId = (e: Edge) => {
  const [p, q] = [`${e.a.x2},${e.a.y2}`, `${e.b.x2},${e.b.y2}`].sort()
  return e.kind === "line" ? `L ${p} ${q}` : `A ${p} ${q} c${e.center.x2},${e.center.y2}`
}

function randomLayer(seed: number): GridLayer {
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const a = new Set<string>()
  const b = new Set<string>()
  for (let y = -10; y < 40; y++)
    for (let x = -10; x < 40; x++) {
      const r = rnd()
      if (r < 0.35) a.add(`${x},${y}`)
      else if (r < 0.45) b.add(`${x},${y}`)
    }
  const mods = new Map<string, PointModifications>([
    ["15,15", { quadrantOverrides: { 0: "concave-nw", 2: "empty" } }],
    ["16,3", { quadrantOverrides: { 1: "convex-ne" } }],
  ])
  return {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [
      { id: "a", points: a },
      { id: "b", points: b, offsetPhaseX: "half", offsetPhaseY: "half" },
    ],
    pointModifications: mods,
  }
}

describe("active outline", () => {
  it("per-tile owned edges together equal the whole-layer boundary", () => {
    const geometry = new TiledLayerGeometry(new BlobEngine()).update(randomLayer(11), 50, 0)
    const whole = new Set(boundaryEdges(geometry.primitives).map(edgeId))

    const tiled: string[] = []
    for (const tile of geometry.tiles!.values()) {
      const x0 = tile.tileX * GEOMETRY_TILE_CELLS
      const y0 = tile.tileY * GEOMETRY_TILE_CELLS
      const x1 = x0 + GEOMETRY_TILE_CELLS - 1
      const y1 = y0 + GEOMETRY_TILE_CELLS - 1
      const nearby = geometry.primitives.filter(
        (p) => p.center.x >= x0 - 1.5 && p.center.x <= x1 + 1.5 && p.center.y >= y0 - 1.5 && p.center.y <= y1 + 1.5,
      )
      tiled.push(...ownedBoundaryEdges(nearby, x0, y0, x1, y1).map(edgeId))
    }

    expect(tiled.length).toBe(new Set(tiled).size) // each edge once
    expect(new Set(tiled)).toEqual(whole)
  })

  it("strokes an isolated dot as four quarter arcs around its center", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "a", points: new Set(["0,0"]) }],
    }
    const { primitives } = new BlobEngine().generateLayerGeometry(layer, 10, 0)
    const arcs: { cx: number; cy: number; r: number; span: number }[] = []
    const sink: PathSink = {
      moveTo() {},
      lineTo() {
        throw new Error("a dot has no straight edges")
      },
      bezierCurveTo() {},
      closePath() {},
      arc(cx, cy, r, a0, a1, ccw) {
        let span = a1 - a0
        if (ccw && span > 0) span -= 2 * Math.PI
        if (!ccw && span < 0) span += 2 * Math.PI
        arcs.push({ cx, cy, r, span })
      },
    }
    appendEdges(sink, ownedBoundaryEdges(primitives, -5, -5, 5, 5), 10)
    expect(arcs).toHaveLength(4)
    for (const a of arcs) {
      expect(a).toMatchObject({ cx: 5, cy: 5, r: 5 })
      expect(Math.abs(Math.abs(a.span) - Math.PI / 2)).toBeLessThan(1e-9)
    }
  })
})
