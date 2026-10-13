import { describe, it, expect } from "vitest"
import { NeighborhoodAnalyzer } from "@/lib/blob-engine/NeighborhoodAnalyzer"
import {
  BIT_NE,
  BIT_NW,
  BIT_SE,
  BIT_SW,
  caseContainedIn,
  getTileTemplates,
  pieceKind,
} from "@/lib/runner/tiles"

// Quadrant indices in the blob engine: 0=SE, 1=SW, 2=NW, 3=NE, in a y-down
// grid. Our tiles are y-up, so "north" in the tile = smaller y in the engine.
const CELL_OF_BIT: Record<number, [number, number]> = {
  [BIT_NW]: [0, 0],
  [BIT_NE]: [1, 0],
  [BIT_SW]: [0, 1],
  [BIT_SE]: [1, 1],
}
// The quadrant of each cell that touches the shared corner (1, 1)
const ENGINE_QUADRANT_OF_BIT: Record<number, 0 | 1 | 2 | 3> = {
  [BIT_NW]: 0, // its SE quadrant
  [BIT_NE]: 1, // its SW quadrant
  [BIT_SE]: 2, // its NW quadrant
  [BIT_SW]: 3, // its NE quadrant
}
const QUAD_SPECS = [
  { bit: BIT_NE, fx: 0.5, fy: 0.5, orthA: BIT_NW, orthB: BIT_SE, diag: BIT_SW },
  { bit: BIT_NW, fx: -0.5, fy: 0.5, orthA: BIT_NE, orthB: BIT_SW, diag: BIT_SE },
  { bit: BIT_SW, fx: -0.5, fy: -0.5, orthA: BIT_NW, orthB: BIT_SE, diag: BIT_NE },
  { bit: BIT_SE, fx: 0.5, fy: -0.5, orthA: BIT_NE, orthB: BIT_SW, diag: BIT_NW },
]

/** Point-in-shape using the same rules, for area checks */
function inside(c: number, u: number, v: number): boolean {
  const q = QUAD_SPECS.find((q) => Math.sign(u) === Math.sign(q.fx) && Math.sign(v) === Math.sign(q.fy))
  if (!q) return false
  const kind = pieceKind(c, q)
  const d = Math.hypot(u - q.fx, v - q.fy)
  if (kind === "full") return true
  if (kind === "disk") return d < 0.5
  if (kind === "bridge") return d > 0.5
  return false
}

describe("corner tiles", () => {
  it("match the blob engine's quadrant classification for all 16 cases", () => {
    const analyzer = new NeighborhoodAnalyzer()
    for (let c = 0; c < 16; c++) {
      const points = new Set<string>()
      for (const bit of [BIT_SW, BIT_SE, BIT_NE, BIT_NW]) {
        if (c & bit) points.add(CELL_OF_BIT[bit].join(","))
      }
      for (const q of QUAD_SPECS) {
        const [x, y] = CELL_OF_BIT[q.bit]
        const hood = analyzer.getNeighborhoodMap({ x, y }, points)
        const engine = analyzer.classifyQuadrant(hood, ENGINE_QUADRANT_OF_BIT[q.bit], points.has(`${x},${y}`))
        const ours = pieceKind(c, q)
        const expected =
          engine === "rectangle" ? "full" : engine === "roundedCorner" ? "disk" : engine === "diagonalBridge" ? "bridge" : "empty"
        expect(ours, `case ${c}, quadrant bit ${q.bit}`).toBe(expected)
      }
    }
  })

  it("never puts an outline on a tile border (seamless tiling)", () => {
    for (const segs of [1, 2, 6]) {
      const templates = getTileTemplates(segs)
      for (let c = 0; c < 16; c++) {
        const seg = templates[c].contour
        for (let k = 0; k < seg.length; k += 4) {
          const [u0, v0, u1, v1] = [seg[k], seg[k + 1], seg[k + 2], seg[k + 3]]
          expect(Math.abs(u0) === 0.5 && u0 === u1).toBe(false)
          expect(Math.abs(v0) === 0.5 && v0 === v1).toBe(false)
          // endpoints on the border are always edge midpoints
          for (const [u, v] of [[u0, v0], [u1, v1]]) {
            if (Math.abs(u) === 0.5) expect(v).toBe(0)
            if (Math.abs(v) === 0.5) expect(u).toBe(0)
          }
        }
      }
    }
  })

  it("has matching outline endpoints across every shared tile edge", () => {
    // For any pair of horizontally adjacent tiles, the left tile's outline
    // touches its right edge midpoint iff the right tile's touches its left.
    const t = getTileTemplates(4)
    const touches = (c: number, u: number, v: number) => {
      const seg = t[c].contour
      for (let k = 0; k < seg.length; k += 2) if (seg[k] === u && seg[k + 1] === v) return true
      return false
    }
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        // shared cells: a's NE/SE are b's NW/SW
        const aNE = !!(a & BIT_NE), aSE = !!(a & BIT_SE)
        const bNW = !!(b & BIT_NW), bSW = !!(b & BIT_SW)
        if (aNE !== bNW || aSE !== bSW) continue
        expect(touches(a, 0.5, 0), `${a}|${b}`).toBe(touches(b, -0.5, 0))
      }
    }
  })

  it("front triangles cover exactly the blob shape", () => {
    const t = getTileTemplates(16)
    for (let c = 0; c < 16; c++) {
      const tris = t[c].tris
      let area = 0
      for (let k = 0; k < tris.length; k += 6) {
        area += Math.abs(
          (tris[k + 2] - tris[k]) * (tris[k + 5] - tris[k + 1]) -
            (tris[k + 4] - tris[k]) * (tris[k + 3] - tris[k + 1]),
        ) / 2
      }
      let hits = 0
      const N = 200
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) if (inside(c, (i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5)) hits++
      expect(area).toBeCloseTo(hits / (N * N), 2)
    }
  })

  it("shapes grow monotonically with filled cells (front-face culling relies on it)", () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        if (!caseContainedIn(a, b)) continue
        for (let i = 0; i < 40; i++)
          for (let j = 0; j < 40; j++) {
            const u = (i + 0.5) / 40 - 0.5
            const v = (j + 0.5) / 40 - 0.5
            if (inside(a, u, v)) expect(inside(b, u, v), `${a}⊂${b} at ${u},${v}`).toBe(true)
          }
      }
    }
  })
})
