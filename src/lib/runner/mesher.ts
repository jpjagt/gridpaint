/**
 * Builds the triangle and line buffers for one chunk of slices.
 *
 * Geometry per chunk, all in chunk-local space (slice s spans
 * z ∈ [-(s+1)·depth, -s·depth]; the character travels toward -Z):
 *
 *  - fronts:   the face of each slice that looks back at the camera. Skipped
 *              wherever the slice in front fully covers it (the camera can
 *              never see it), and runs of solid tiles are merged.
 *  - sides:    the cut edges, extruded along Z. Consecutive slices with the
 *              same tile shape are merged into one long wall. Back faces are
 *              never generated: the camera always looks forward.
 *  - outlines: where consecutive slices differ, both slice outlines.
 *  - seams:    where consecutive slices are equal, their shared outline (the
 *              visible joint between stacked plates).
 */

import type { ChunkMeshData, SliceGrid, TileTemplate } from "@/types/runner"
import { MIN_ROW } from "./config"
import { CASE_FULL, caseContainedIn, getTileTemplates } from "./tiles"

class FloatBuilder {
  data: Float32Array
  length = 0

  constructor(initial = 4096) {
    this.data = new Float32Array(initial)
  }

  reserve(n: number) {
    if (this.length + n <= this.data.length) return
    let cap = this.data.length * 2
    while (cap < this.length + n) cap *= 2
    const next = new Float32Array(cap)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }

  /** Exact-size copy, safe to transfer */
  finish(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

/**
 * Emits line segments, merging collinear runs: horizontal ones as they come
 * (ground lines would otherwise be hundreds of tiny segments per slice) and
 * vertical ones per column (tall straight edges would be one per row).
 */
class LineBuilder {
  out = new FloatBuilder()
  private hy = NaN
  private hz = NaN
  private hx0 = 0
  private hx1 = 0
  private vz = NaN
  private verticals = new Map<number, [number, number]>()

  segment(x0: number, y0: number, x1: number, y1: number, z: number) {
    if (x0 === x1) {
      if (z !== this.vz) {
        this.flushVerticals()
        this.vz = z
      }
      if (y1 < y0) {
        const t = y0
        y0 = y1
        y1 = t
      }
      const open = this.verticals.get(x0)
      if (open) {
        if (open[1] === y0) {
          open[1] = y1
          return
        }
        if (open[0] === y1) {
          open[0] = y0
          return
        }
        this.push(x0, open[0], x0, open[1], z)
      }
      this.verticals.set(x0, [y0, y1])
      return
    }
    if (y0 === y1) {
      if (x1 < x0) {
        const t = x0
        x0 = x1
        x1 = t
      }
      if (y0 === this.hy && z === this.hz && x0 === this.hx1) {
        this.hx1 = x1
        return
      }
      this.flush()
      this.hy = y0
      this.hz = z
      this.hx0 = x0
      this.hx1 = x1
      return
    }
    this.flush()
    this.push(x0, y0, x1, y1, z)
  }

  flush() {
    if (!Number.isNaN(this.hy)) {
      this.push(this.hx0, this.hy, this.hx1, this.hy, this.hz)
      this.hy = NaN
    }
  }

  private push(x0: number, y0: number, x1: number, y1: number, z: number) {
    const b = this.out
    b.reserve(6)
    const d = b.data
    let i = b.length
    d[i++] = x0
    d[i++] = y0
    d[i++] = z
    d[i++] = x1
    d[i++] = y1
    d[i++] = z
    b.length = i
  }

  private flushVerticals() {
    for (const [x, [y0, y1]] of this.verticals) this.push(x, y0, x, y1, this.vz)
    this.verticals.clear()
  }

  finish(): Float32Array {
    this.flush()
    this.flushVerticals()
    return this.out.finish()
  }
}

/** Same merging idea for wall quads: side-by-side and stacked walls become one */
class WallBuilder {
  out = new FloatBuilder(16384)
  private hy = NaN
  private hz0 = NaN
  private hz1 = NaN
  private hx0 = 0
  private hx1 = 0

  private verticals = new Map<string, [number, number, number, number, number]>()

  wall(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) {
    if (x0 === x1) {
      if (y1 < y0) {
        const t = y0
        y0 = y1
        y1 = t
      }
      const key = `${x0}|${z0}|${z1}`
      const open = this.verticals.get(key)
      if (open) {
        if (open[2] === y0) {
          open[2] = y1
          return
        }
        if (open[1] === y1) {
          open[1] = y0
          return
        }
        this.push(open[0], open[1], open[0], open[2], open[3], open[4])
      }
      this.verticals.set(key, [x0, y0, y1, z0, z1])
      return
    }
    if (y0 === y1) {
      if (x1 < x0) {
        const t = x0
        x0 = x1
        x1 = t
      }
      if (y0 === this.hy && z0 === this.hz0 && z1 === this.hz1 && x0 === this.hx1) {
        this.hx1 = x1
        return
      }
      this.flush()
      this.hy = y0
      this.hz0 = z0
      this.hz1 = z1
      this.hx0 = x0
      this.hx1 = x1
      return
    }
    this.flush()
    this.push(x0, y0, x1, y1, z0, z1)
  }

  flush() {
    if (!Number.isNaN(this.hy)) {
      this.push(this.hx0, this.hy, this.hx1, this.hy, this.hz0, this.hz1)
      this.hy = NaN
    }
  }

  private push(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) {
    const b = this.out
    b.reserve(18)
    const d = b.data
    let i = b.length
    d[i++] = x0; d[i++] = y0; d[i++] = z0
    d[i++] = x1; d[i++] = y1; d[i++] = z0
    d[i++] = x1; d[i++] = y1; d[i++] = z1
    d[i++] = x0; d[i++] = y0; d[i++] = z0
    d[i++] = x1; d[i++] = y1; d[i++] = z1
    d[i++] = x0; d[i++] = y0; d[i++] = z1
    b.length = i
  }

  finish(): Float32Array {
    this.flush()
    for (const v of this.verticals.values()) this.push(v[0], v[1], v[0], v[2], v[3], v[4])
    this.verticals.clear()
    return this.out.finish()
  }
}

export interface TileLayout {
  /** Number of corner tiles horizontally / vertically */
  tilesX: number
  tilesY: number
  /** Grid-corner index of the first tile */
  vx0: number
  vy0: number
}

export function tileLayout(grid: SliceGrid): TileLayout {
  return {
    tilesX: grid.cols + 1,
    tilesY: grid.rows + 1,
    vx0: -grid.halfWidth,
    vy0: MIN_ROW,
  }
}

/** Cell value for metal cells (1 = regular filled cell) */
export const CELL_METAL = 2
/** Set on a tile's case when any of its cells is metal; the low 4 bits are the shape */
export const METAL_BIT = 16
const SHAPE = 15

/**
 * Corner-tile case for every grid corner of a slice: shape bits (0..15),
 * plus METAL_BIT when the tile touches a metal cell.
 */
export function computeCases(grid: SliceGrid, out: Uint8Array): Uint8Array {
  const { cols, rows, cells } = grid
  const tx = cols + 1
  const ty = rows + 1
  // Corner (i, j) sits at the bottom-left of cell (i, j); cells outside are empty.
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let c = 0
      let v = 0
      const hasL = i > 0
      const hasR = i < cols
      if (j > 0) {
        const row = (j - 1) * cols
        if (hasL && (v = cells[row + i - 1])) c |= 1 | (v === CELL_METAL ? METAL_BIT : 0) // SW
        if (hasR && (v = cells[row + i])) c |= 2 | (v === CELL_METAL ? METAL_BIT : 0) // SE
      }
      if (j < rows) {
        const row = j * cols
        if (hasR && (v = cells[row + i])) c |= 4 | (v === CELL_METAL ? METAL_BIT : 0) // NE
        if (hasL && (v = cells[row + i - 1])) c |= 8 | (v === CELL_METAL ? METAL_BIT : 0) // NW
      }
      out[j * tx + i] = c
    }
  }
  return out
}

/**
 * @param slices n + 1 slices: the slice just before the chunk, then the
 *               chunk's n slices.
 */
export function buildChunkMesh(
  slices: SliceGrid[],
  sliceDepth: number,
  arcSegments: number,
  colLimit = Infinity,
): ChunkMeshData {
  const templates = getTileTemplates(arcSegments)
  const layout = tileLayout(slices[0])
  const { tilesX, tilesY, vx0, vy0 } = layout
  // Tiles outside |x| <= colLimit are left out (camera can't see them up close)
  const iMin = Math.max(0, Math.floor(-colLimit - vx0))
  const iMax = Math.min(tilesX - 1, Math.ceil(colLimit + 1 - vx0))
  const tileCount = tilesX * tilesY
  const n = slices.length - 1

  const cases = slices.map((s) => computeCases(s, new Uint8Array(tileCount)))

  const fronts = new FloatBuilder(32768)
  const metalFronts = new FloatBuilder(1024)
  const walls = new WallBuilder()
  const metalWalls = new FloatBuilder(1024)
  const metalNormals = new FloatBuilder(1024)
  const outlines = new LineBuilder()
  const seams = new LineBuilder()

  // --- Fronts -------------------------------------------------------------
  for (let s = 0; s < n; s++) {
    const cur = cases[s + 1]
    const prev = cases[s]
    const z = -s * sliceDepth
    // runs of solid tiles, merged into rectangles across rows
    const rects = new Map<string, { xa: number; xb: number; y0: number; y1: number; metal: boolean }>()
    const emitRect = (r: { xa: number; xb: number; y0: number; y1: number; metal: boolean }) =>
      pushQuad(r.metal ? metalFronts : fronts, r.xa, r.y0, r.xb, r.y1, z)
    for (let j = 0; j < tilesY; j++) {
      const y = vy0 + j
      let runStart = -1
      let runMetal = false
      const flushRun = (endExclusive: number) => {
        if (runStart < 0) return
        const xa = vx0 + runStart - 1
        const xb = vx0 + endExclusive - 1
        // stack onto the identical run in the row below, if there is one
        const key = `${xa}|${xb}|${runMetal ? 1 : 0}`
        const rect = rects.get(key)
        if (rect && rect.y1 === y - 0.5) {
          rect.y1 = y + 0.5
        } else {
          if (rect) emitRect(rect)
          rects.set(key, { xa, xb, y0: y - 0.5, y1: y + 0.5, metal: runMetal })
        }
        runStart = -1
      }
      for (let i = iMin; i <= iMax; i++) {
        const t = j * tilesX + i
        const c = cur[t] & SHAPE
        const metal = (cur[t] & METAL_BIT) !== 0
        if (c === 0 || caseContainedIn(c, prev[t] & SHAPE)) {
          flushRun(i)
          continue
        }
        if (c === CASE_FULL) {
          if (runStart >= 0 && runMetal !== metal) flushRun(i)
          if (runStart < 0) {
            runStart = i
            runMetal = metal
          }
          continue
        }
        flushRun(i)
        pushTris(metal ? metalFronts : fronts, templates[c], vx0 + i - 0.5, y, z)
      }
      flushRun(iMax + 1)
    }
    for (const r of rects.values()) emitRect(r)
  }

  // --- Walls (merged along Z while the tile shape stays the same) ---------
  const runCase = new Uint8Array(tileCount)
  const runStart = new Int32Array(tileCount)
  runCase.set(cases[1])
  const emitWall = (t: number, caseByte: number, s0: number, s1: number) => {
    const c = caseByte & SHAPE
    if (c === 0 || c === CASE_FULL) return
    const i = t % tilesX
    if (i < iMin || i > iMax) return
    const j = (t - i) / tilesX
    const x = vx0 + i - 0.5
    const y = vy0 + j
    const z0 = -s0 * sliceDepth
    const z1 = -s1 * sliceDepth
    const seg = templates[c].contour
    if (caseByte & METAL_BIT) {
      pushNormalWalls(metalWalls, metalNormals, templates[c], x, y, z0, z1)
      return
    }
    for (let k = 0; k < seg.length; k += 4) {
      walls.wall(x + seg[k], y + seg[k + 1], x + seg[k + 2], y + seg[k + 3], z0, z1)
    }
  }
  for (let s = 1; s < n; s++) {
    const cur = cases[s + 1]
    for (let t = 0; t < tileCount; t++) {
      const c = cur[t]
      if (c !== runCase[t]) {
        emitWall(t, runCase[t], runStart[t], s)
        runCase[t] = c
        runStart[t] = s
      }
    }
  }
  for (let t = 0; t < tileCount; t++) emitWall(t, runCase[t], runStart[t], n)

  // --- Lines at each slice boundary ---------------------------------------
  for (let s = 0; s < n; s++) {
    const a = cases[s]
    const b = cases[s + 1]
    const z = -s * sliceDepth
    for (let t = 0; t < tileCount; t++) {
      const i = t % tilesX
      if (i < iMin || i > iMax) continue
      const ca = a[t] & SHAPE
      const cb = b[t] & SHAPE
      if (ca === cb) {
        if (ca !== 0 && ca !== CASE_FULL) emitContour(seams, templates[ca], t, layout, z)
      } else {
        if (ca !== 0 && ca !== CASE_FULL) emitContour(outlines, templates[ca], t, layout, z)
        if (cb !== 0 && cb !== CASE_FULL) emitContour(outlines, templates[cb], t, layout, z)
      }
    }
  }

  return {
    fronts: fronts.finish(),
    metalFronts: metalFronts.finish(),
    metalSides: metalWalls.finish(),
    metalSideNormals: metalNormals.finish(),
    sides: walls.finish(),
    outlines: outlines.finish(),
    seams: seams.finish(),
  }
}

function emitContour(
  lines: LineBuilder,
  tpl: TileTemplate,
  t: number,
  layout: TileLayout,
  z: number,
) {
  const i = t % layout.tilesX
  const j = (t - i) / layout.tilesX
  const x = layout.vx0 + i - 0.5
  const y = layout.vy0 + j
  const seg = tpl.contour
  for (let k = 0; k < seg.length; k += 4) {
    lines.segment(x + seg[k], y + seg[k + 1], x + seg[k + 2], y + seg[k + 3], z)
  }
}

/** Walls with per-vertex normals (smooth along arcs), unmerged */
function pushNormalWalls(
  pos: FloatBuilder,
  nrm: FloatBuilder,
  tpl: TileTemplate,
  x: number,
  y: number,
  z0: number,
  z1: number,
) {
  const seg = tpl.contour
  const nn = tpl.normals
  const count = (seg.length / 4) * 18
  pos.reserve(count)
  nrm.reserve(count)
  const p = pos.data
  const q = nrm.data
  let o = pos.length
  for (let k = 0; k < seg.length; k += 4) {
    const ax = x + seg[k], ay = y + seg[k + 1], bx = x + seg[k + 2], by = y + seg[k + 3]
    const anx = nn[k], any = nn[k + 1], bnx = nn[k + 2], bny = nn[k + 3]
    const verts = [
      ax, ay, z0, anx, any, bx, by, z0, bnx, bny, bx, by, z1, bnx, bny,
      ax, ay, z0, anx, any, bx, by, z1, bnx, bny, ax, ay, z1, anx, any,
    ]
    for (let v = 0; v < verts.length; v += 5) {
      p[o] = verts[v]
      p[o + 1] = verts[v + 1]
      p[o + 2] = verts[v + 2]
      q[o] = verts[v + 3]
      q[o + 1] = verts[v + 4]
      q[o + 2] = 0
      o += 3
    }
  }
  pos.length = o
  nrm.length = o
}

function pushTris(b: FloatBuilder, tpl: TileTemplate, x: number, y: number, z: number) {
  const src = tpl.tris
  b.reserve((src.length / 2) * 3)
  const d = b.data
  let o = b.length
  for (let k = 0; k < src.length; k += 2) {
    d[o++] = x + src[k]
    d[o++] = y + src[k + 1]
    d[o++] = z
  }
  b.length = o
}

function pushQuad(b: FloatBuilder, x0: number, y0: number, x1: number, y1: number, z: number) {
  b.reserve(18)
  const d = b.data
  let o = b.length
  d[o++] = x0; d[o++] = y0; d[o++] = z
  d[o++] = x1; d[o++] = y0; d[o++] = z
  d[o++] = x1; d[o++] = y1; d[o++] = z
  d[o++] = x0; d[o++] = y0; d[o++] = z
  d[o++] = x1; d[o++] = y1; d[o++] = z
  d[o++] = x0; d[o++] = y1; d[o++] = z
  b.length = o
}
