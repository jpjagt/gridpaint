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
 * Emits line segments, merging consecutive collinear horizontal segments
 * (ground lines would otherwise be hundreds of tiny segments per slice).
 */
class LineBuilder {
  out = new FloatBuilder()
  private hy = NaN
  private hz = NaN
  private hx0 = 0
  private hx1 = 0

  segment(x0: number, y0: number, x1: number, y1: number, z: number) {
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

  finish(): Float32Array {
    this.flush()
    return this.out.finish()
  }
}

/** Same merging idea for wall quads: horizontal walls side by side become one */
class WallBuilder {
  out = new FloatBuilder(16384)
  private hy = NaN
  private hz0 = NaN
  private hz1 = NaN
  private hx0 = 0
  private hx1 = 0

  wall(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) {
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

/** Corner-tile case for every grid corner of a slice */
export function computeCases(grid: SliceGrid, out: Uint8Array): Uint8Array {
  const { cols, rows, cells } = grid
  const tx = cols + 1
  const ty = rows + 1
  // Corner (i, j) sits at the bottom-left of cell (i, j); cells outside are empty.
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let c = 0
      const hasL = i > 0
      const hasR = i < cols
      if (j > 0) {
        const row = (j - 1) * cols
        if (hasL && cells[row + i - 1]) c |= 1 // SW
        if (hasR && cells[row + i]) c |= 2 // SE
      }
      if (j < rows) {
        const row = j * cols
        if (hasR && cells[row + i]) c |= 4 // NE
        if (hasL && cells[row + i - 1]) c |= 8 // NW
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
  const walls = new WallBuilder()
  const outlines = new LineBuilder()
  const seams = new LineBuilder()

  // --- Fronts -------------------------------------------------------------
  for (let s = 0; s < n; s++) {
    const cur = cases[s + 1]
    const prev = cases[s]
    const z = -s * sliceDepth
    for (let j = 0; j < tilesY; j++) {
      const y = vy0 + j
      let runStart = -1
      const flushRun = (endExclusive: number) => {
        if (runStart < 0) return
        const xa = vx0 + runStart - 1
        const xb = vx0 + endExclusive - 1
        pushQuad(fronts, xa, y - 0.5, xb, y + 0.5, z)
        runStart = -1
      }
      for (let i = iMin; i <= iMax; i++) {
        const t = j * tilesX + i
        const c = cur[t]
        if (c === 0 || caseContainedIn(c, prev[t])) {
          flushRun(i)
          continue
        }
        if (c === CASE_FULL) {
          if (runStart < 0) runStart = i
          continue
        }
        flushRun(i)
        pushTris(fronts, templates[c], vx0 + i - 0.5, y, z)
      }
      flushRun(iMax + 1)
    }
  }

  // --- Walls (merged along Z while the tile shape stays the same) ---------
  const runCase = new Uint8Array(tileCount)
  const runStart = new Int32Array(tileCount)
  runCase.set(cases[1])
  const emitWall = (t: number, c: number, s0: number, s1: number) => {
    if (c === 0 || c === CASE_FULL) return
    const i = t % tilesX
    if (i < iMin || i > iMax) return
    const j = (t - i) / tilesX
    const x = vx0 + i - 0.5
    const y = vy0 + j
    const z0 = -s0 * sliceDepth
    const z1 = -s1 * sliceDepth
    const seg = templates[c].contour
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
      const ca = a[t]
      const cb = b[t]
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
