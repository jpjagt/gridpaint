/**
 * Builds closed, indexed solids for the 3D preview straight from a layer's
 * piece grid (see blobPieces.ts) — no SVG, no path parsing, no earcut except
 * around cutouts.
 *
 * Per layer, occupying z ∈ [z0, z0 + 1]:
 *
 *  - caps:   front (+z) and back (-z). Runs of full squares in a row are
 *            merged into one strip; disk and bridge pieces are fans. Every
 *            lattice vertex an outline or non-full piece touches stays in the
 *            strips, so the caps have no T-junctions.
 *  - walls:  each square side covered on exactly one side, plus every arc.
 *            Straight walls get flat normals; arc vertices get the radial
 *            normal, so arcs shade smoothly and flow into tangent straight
 *            walls (an arc endpoint's radial normal *is* the wall normal, and
 *            the two share the vertex). Caps never share vertices with walls,
 *            which keeps the cap/wall edge hard.
 *  - lines:  the outline at both caps plus a vertical line at every corner
 *            where the outline turns — what EdgesGeometry(15°) gave before.
 *
 * All layers append into one builder, so the whole model is one geometry
 * and one draw call (layers are told apart by a per-vertex colour).
 */

import * as THREE from "three"
import {
  CORNER_DX,
  CORNER_DY,
  PIECE_BRIDGE,
  PIECE_DISK,
  PIECE_EMPTY,
  PIECE_FULL,
  SIDE_COVERAGE,
} from "./blobPieces"
import type {
  CutoutHole,
  CutoutRegion,
  PieceGrid,
  TileLayerMeshOptions,
  TileMeshBuffers,
} from "@/types/threejs"

class FloatBuffer {
  data: Float32Array
  length = 0

  constructor(initial = 1 << 14) {
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

  push3(a: number, b: number, c: number) {
    this.reserve(3)
    const d = this.data
    d[this.length++] = a
    d[this.length++] = b
    d[this.length++] = c
  }

  finish(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

class IndexBuffer {
  data: Uint32Array
  length = 0

  constructor(initial = 1 << 15) {
    this.data = new Uint32Array(initial)
  }

  push3(a: number, b: number, c: number) {
    if (this.length + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    const d = this.data
    d[this.length++] = a
    d[this.length++] = b
    d[this.length++] = c
  }

  finish(): Uint32Array {
    return this.data.slice(0, this.length)
  }
}

/** Axis directions, also used for normals: 0 = +x, 1 = +y, 2 = -x, 3 = -y */
const DIR_X = [1, 0, -1, 0] as const
const DIR_Y = [0, 1, 0, -1] as const
/** Neighbour square across side k */
const SIDE_NX = [0, 1, 0, -1] as const
const SIDE_NY = [-1, 0, 1, 0] as const

/**
 * Unit arc offsets per centre corner c: the quarter circle around corner c
 * from corner c+1 (t = 0) to corner c+3 (t = n), counter-clockwise.
 * Endpoints are exact axis vectors so they land on lattice vertices.
 */
function arcTable(n: number): { ux: Float64Array; uy: Float64Array }[] {
  const out = []
  for (let c = 0; c < 4; c++) {
    const ux = new Float64Array(n + 1)
    const uy = new Float64Array(n + 1)
    for (let t = 0; t <= n; t++) {
      const a = ((c + t / n) * Math.PI) / 2
      ux[t] = Math.cos(a)
      uy[t] = Math.sin(a)
    }
    ux[0] = DIR_X[c]
    uy[0] = DIR_Y[c]
    ux[n] = DIR_X[(c + 1) % 4]
    uy[n] = DIR_Y[(c + 1) % 4]
    out.push({ ux, uy })
  }
  return out
}

export class TileMeshBuilder {
  private positions = new FloatBuffer()
  private normals = new FloatBuffer()
  private colors = new FloatBuffer()
  private indices = new IndexBuffer()
  private lines = new FloatBuffer()
  private vertexCount = 0
  private color: [number, number, number] = [1, 1, 1]

  get isEmpty(): boolean {
    return this.indices.length === 0
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.positions.push3(x, y, z)
    this.normals.push3(nx, ny, nz)
    this.colors.push3(this.color[0], this.color[1], this.color[2])
    return this.vertexCount++
  }

  private line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.lines.push3(x0, y0, z0)
    this.lines.push3(x1, y1, z1)
  }

  addLayer(grid: PieceGrid, regions: CutoutRegion[], options: TileLayerMeshOptions): void {
    const { width: W, height: H, codes, i0, j0 } = grid
    const { z0, scale: sf, arcSegments } = options
    const z1 = z0 + 1
    const n = Math.max(1, Math.round(arcSegments))
    const arcs = arcTable(n)
    this.color = options.color

    const VW = W + 1
    const VH = H + 1
    const vx = (vi: number) => ((i0 + vi) / 2) * sf
    const vy = (vj: number) => ((j0 + vj) / 2) * sf
    const coverAt = (i: number, j: number) =>
      i < 0 || j < 0 || i >= W || j >= H ? 0 : SIDE_COVERAGE[codes[j * W + i]]

    // Squares whose cap comes from a cutout region instead of the run/fan pass
    const inRegion = new Uint8Array(W * H)
    for (const r of regions) {
      for (let j = r.j0; j < r.j1; j++) inRegion.fill(1, j * W + r.i0, j * W + r.i1)
    }

    // A lattice vertex must stay in the cap strips unless all four squares
    // around it are plain full squares (otherwise a neighbour uses it).
    const needed = new Uint8Array(VW * VH)
    for (let vi = 0; vi < VW; vi++) {
      needed[vi] = 1
      needed[H * VW + vi] = 1
    }
    for (let vj = 0; vj < VH; vj++) {
      needed[vj * VW] = 1
      needed[vj * VW + W] = 1
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const s = j * W + i
        if (codes[s] === PIECE_FULL && !inRegion[s]) continue
        const v = j * VW + i
        needed[v] = needed[v + 1] = needed[v + VW] = needed[v + VW + 1] = 1
      }
    }

    // Shared cap vertices (front, back) and wall vertices (per normal dir & level)
    const capFront = new Int32Array(VW * VH).fill(-1)
    const capBack = new Int32Array(VW * VH).fill(-1)
    const cap = (v: number, front: boolean): number => {
      const map = front ? capFront : capBack
      let idx = map[v]
      if (idx < 0) {
        const vi = v % VW
        idx = this.vertex(vx(vi), vy((v - vi) / VW), front ? z1 : z0, 0, 0, front ? 1 : -1)
        map[v] = idx
      }
      return idx
    }
    const wallMap = new Int32Array(VW * VH * 8).fill(-1)
    const wallVertex = (v: number, dir: number, top: boolean): number => {
      const key = (v * 4 + dir) * 2 + (top ? 1 : 0)
      let idx = wallMap[key]
      if (idx < 0) {
        const vi = v % VW
        idx = this.vertex(vx(vi), vy((v - vi) / VW), top ? z1 : z0, DIR_X[dir], DIR_Y[dir], 0)
        wallMap[key] = idx
      }
      return idx
    }
    // Outline directions leaving each lattice vertex, for the corner lines
    const dirCount = new Uint8Array(VW * VH)
    const dirMask = new Uint8Array(VW * VH)
    const markDir = (v: number, dir: number) => {
      dirCount[v]++
      dirMask[v] |= 1 << dir
    }

    const idx = this.indices
    // Wall quad for outline segment p → q (material on the left)
    const quad = (p0: number, q0: number, p1: number, q1: number) => {
      idx.push3(p0, q0, q1)
      idx.push3(p0, q1, p1)
    }

    // --- Caps: full-square runs as T-junction-free strips -------------------
    const bottom: number[] = []
    const top: number[] = []
    for (let j = 0; j < H; j++) {
      let i = 0
      while (i < W) {
        const s = j * W + i
        if (codes[s] !== PIECE_FULL || inRegion[s]) {
          i++
          continue
        }
        const a = i
        while (i < W && codes[j * W + i] === PIECE_FULL && !inRegion[j * W + i]) i++
        bottom.length = 0
        top.length = 0
        for (let x = a; x <= i; x++) {
          if (x === a || x === i || needed[j * VW + x]) bottom.push(x)
          if (x === a || x === i || needed[(j + 1) * VW + x]) top.push(x)
        }
        for (const front of [true, false]) {
          let b = 0
          let t = 0
          while (b < bottom.length - 1 || t < top.length - 1) {
            const pb = cap(j * VW + bottom[b], front)
            const pt = cap((j + 1) * VW + top[t], front)
            if (t === top.length - 1 || (b < bottom.length - 1 && bottom[b + 1] <= top[t + 1])) {
              const nb = cap(j * VW + bottom[++b], front)
              if (front) idx.push3(pb, nb, pt)
              else idx.push3(pb, pt, nb)
            } else {
              const nt = cap((j + 1) * VW + top[++t], front)
              if (front) idx.push3(pb, nt, pt)
              else idx.push3(pb, pt, nt)
            }
          }
        }
      }
    }

    // --- Per-square: arc pieces, straight walls ----------------------------
    const arcCap = new Int32Array(n + 1)
    const arcLo = new Int32Array(n + 1)
    const arcHi = new Int32Array(n + 1)
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const code = codes[j * W + i]
        if (code === PIECE_EMPTY) continue
        const v00 = j * VW + i
        const cornerV = (k: number) => v00 + CORNER_DX[k] + CORNER_DY[k] * VW

        // Straight walls: covered sides whose neighbour doesn't cover them back
        const cover = SIDE_COVERAGE[code]
        for (let k = 0; k < 4; k++) {
          if (!(cover & (1 << k))) continue
          if (coverAt(i + SIDE_NX[k], j + SIDE_NY[k]) & (1 << ((k + 2) % 4))) continue
          const p = cornerV(k)
          const q = cornerV((k + 1) % 4)
          const nd = (k + 3) % 4
          quad(wallVertex(p, nd, false), wallVertex(q, nd, false), wallVertex(p, nd, true), wallVertex(q, nd, true))
          const px = vx(p % VW), py = vy((p - (p % VW)) / VW)
          const qx = vx(q % VW), qy = vy((q - (q % VW)) / VW)
          this.line(px, py, z0, qx, qy, z0)
          this.line(px, py, z1, qx, qy, z1)
          markDir(p, k)
          markDir(q, (k + 2) % 4)
        }

        if (code === PIECE_FULL) continue
        const disk = code < PIECE_BRIDGE
        const c = disk ? code - PIECE_DISK : code - PIECE_BRIDGE
        const { ux, uy } = arcs[c]
        const cx = (i0 + i + CORNER_DX[c]) / 2
        const cy = (j0 + j + CORNER_DY[c]) / 2
        const vNext = cornerV((c + 1) % 4)
        const vPrev = cornerV((c + 3) % 4)
        const ax = (t: number) => (cx + 0.5 * ux[t]) * sf
        const ay = (t: number) => (cy + 0.5 * uy[t]) * sf

        // Caps: disk fans from its centre corner, bridge from the opposite one
        for (const front of [true, false]) {
          arcCap[0] = cap(vNext, front)
          arcCap[n] = cap(vPrev, front)
          for (let t = 1; t < n; t++) {
            arcCap[t] = this.vertex(ax(t), ay(t), front ? z1 : z0, 0, 0, front ? 1 : -1)
          }
          const hub = cap(cornerV(disk ? c : (c + 2) % 4), front)
          for (let t = 0; t < n; t++) {
            // disk: (hub, a_t, a_t+1) is CCW; bridge: (hub, a_t+1, a_t)
            if (disk === front) idx.push3(hub, arcCap[t], arcCap[t + 1])
            else idx.push3(hub, arcCap[t + 1], arcCap[t])
          }
        }

        // Arc wall with radial normals (outward from the disk centre for a
        // disk, towards it for a bridge); endpoints share the straight-wall
        // vertices that continue them.
        const sign = disk ? 1 : -1
        const dNext = disk ? c : (c + 2) % 4
        const dPrev = disk ? (c + 1) % 4 : (c + 3) % 4
        arcLo[0] = wallVertex(vNext, dNext, false)
        arcHi[0] = wallVertex(vNext, dNext, true)
        arcLo[n] = wallVertex(vPrev, dPrev, false)
        arcHi[n] = wallVertex(vPrev, dPrev, true)
        for (let t = 1; t < n; t++) {
          arcLo[t] = this.vertex(ax(t), ay(t), z0, sign * ux[t], sign * uy[t], 0)
          arcHi[t] = this.vertex(ax(t), ay(t), z1, sign * ux[t], sign * uy[t], 0)
        }
        for (let t = 0; t < n; t++) {
          if (disk) quad(arcLo[t], arcLo[t + 1], arcHi[t], arcHi[t + 1])
          else quad(arcLo[t + 1], arcLo[t], arcHi[t + 1], arcHi[t])
          this.line(ax(t), ay(t), z0, ax(t + 1), ay(t + 1), z0)
          this.line(ax(t), ay(t), z1, ax(t + 1), ay(t + 1), z1)
        }
        // Arcs leave both endpoints heading towards the corner opposite c
        markDir(vNext, (c + 1) % 4)
        markDir(vPrev, c)
      }
    }

    // --- Cutout regions -------------------------------------------------------
    for (const region of regions) {
      this.addCutoutRegion(region, grid, VW, cap, z0, z1, sf, n)
    }

    // --- Corner lines where the outline turns --------------------------------
    for (let v = 0; v < VW * VH; v++) {
      const count = dirCount[v]
      if (count === 0) continue
      const mask = dirMask[v]
      if (count === 2 && (mask === 0b0101 || mask === 0b1010)) continue
      const vi = v % VW
      const x = vx(vi)
      const y = vy((v - vi) / VW)
      this.line(x, y, z0, x, y, z1)
    }
  }

  /**
   * Cap a rectangle of full squares with holes punched out (earcut), plus
   * the hole walls. The rectangle border keeps every lattice vertex so it
   * stitches to the neighbouring strips without T-junctions.
   */
  private addCutoutRegion(
    region: CutoutRegion,
    grid: PieceGrid,
    VW: number,
    cap: (v: number, front: boolean) => number,
    z0: number,
    z1: number,
    sf: number,
    arcSegments: number,
  ) {
    const { i0, j0 } = grid
    // Border lattice vertices, counter-clockwise
    const border: [number, number][] = []
    for (let i = region.i0; i < region.i1; i++) border.push([i, region.j0])
    for (let j = region.j0; j < region.j1; j++) border.push([region.i1, j])
    for (let i = region.i1; i > region.i0; i--) border.push([i, region.j1])
    for (let j = region.j1; j > region.j0; j--) border.push([region.i0, j])

    const contour = border.map(([i, j]) => new THREE.Vector2((i0 + i) / 2, (j0 + j) / 2))
    const holes = region.holes.map((h) => holeOutline(h, arcSegments))
    const faces = THREE.ShapeUtils.triangulateShape(
      contour,
      holes.map((h) => h.points.map(([x, y]) => new THREE.Vector2(x, y))),
    )
    const all: [number, number][] = [
      ...contour.map((p): [number, number] => [p.x, p.y]),
      ...holes.flatMap((h) => h.points),
    ]
    const nb = border.length

    // Earcut drops collinear border vertices; put them back by fanning each
    // triangle edge that skips over some.
    const between = (u: number, v: number): number[] | null => {
      for (const step of [1, nb - 1]) {
        const path: number[] = []
        let k = (u + step) % nb
        while (k !== v) {
          path.push(k)
          k = (k + step) % nb
        }
        const [ux, uy] = border[u]
        const [wx, wy] = border[v]
        const onEdge = path.every((p) => {
          const [px, py] = border[p]
          return (
            (ux === wx && px === ux && (py - uy) * (py - wy) < 0) ||
            (uy === wy && py === uy && (px - ux) * (px - wx) < 0)
          )
        })
        if (onEdge) return path
      }
      return null
    }
    const triangles: [number, number, number][] = []
    const queue = faces.map((f) => [f[0], f[1], f[2]] as [number, number, number])
    while (queue.length > 0) {
      const tri = queue.pop()!
      let split = false
      for (let e = 0; e < 3 && !split; e++) {
        const u = tri[e]
        const v = tri[(e + 1) % 3]
        const w = tri[(e + 2) % 3]
        if (u >= nb || v >= nb || (u + 1) % nb === v || (v + 1) % nb === u) continue
        const path = between(u, v)
        if (!path || path.length === 0) continue
        const seq = [u, ...path, v]
        for (let m = 0; m < seq.length - 1; m++) queue.push([seq[m], seq[m + 1], w])
        split = true
      }
      if (!split) triangles.push(tri)
    }

    for (const front of [true, false]) {
      const z = front ? z1 : z0
      const ids = all.map(([x, y], k) =>
        k < nb
          ? cap((border[k][1]) * VW + border[k][0], front)
          : this.vertex(x * sf, y * sf, z, 0, 0, front ? 1 : -1),
      )
      for (const [a, b, c] of triangles) {
        const [ax, ay] = all[a]
        const [bx, by] = all[b]
        const [cx, cy] = all[c]
        const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0
        if (ccw === front) this.indices.push3(ids[a], ids[b], ids[c])
        else this.indices.push3(ids[a], ids[c], ids[b])
      }
    }

    // Hole walls: outline points are CCW, so walk them backwards to keep the
    // material on the left; normals point into the hole.
    for (const hole of holes) {
      const m = hole.points.length
      const lo: number[] = []
      const hi: number[] = []
      for (let k = 0; k < m; k++) {
        const [x, y] = hole.points[k]
        const [nx, ny] = hole.normals[k]
        lo.push(this.vertex(x * sf, y * sf, z0, nx, ny, 0))
        hi.push(this.vertex(x * sf, y * sf, z1, nx, ny, 0))
      }
      for (let k = 0; k < m; k++) {
        const p = (k + 1) % m
        const q = k
        this.indices.push3(lo[p], lo[q], hi[q])
        this.indices.push3(lo[p], hi[q], hi[p])
        const [x0, y0] = hole.points[p]
        const [x1, y1] = hole.points[q]
        this.line(x0 * sf, y0 * sf, z0, x1 * sf, y1 * sf, z0)
        this.line(x0 * sf, y0 * sf, z1, x1 * sf, y1 * sf, z1)
      }
    }
  }

  finish(): TileMeshBuffers {
    return {
      positions: this.positions.finish(),
      normals: this.normals.finish(),
      colors: this.colors.finish(),
      indices: this.indices.finish(),
      lines: this.lines.finish(),
    }
  }
}

/**
 * Counter-clockwise outline of a circle / pill hole, with per-point normals
 * pointing into the hole (radial on the round ends).
 */
function holeOutline(
  h: CutoutHole,
  arcSegments: number,
): { points: [number, number][]; normals: [number, number][] } {
  const points: [number, number][] = []
  const normals: [number, number][] = []
  const dx = h.ex - h.sx
  const dy = h.ey - h.sy
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) {
    const m = 4 * arcSegments
    for (let k = 0; k < m; k++) {
      const a = (2 * Math.PI * k) / m
      points.push([h.sx + h.radius * Math.cos(a), h.sy + h.radius * Math.sin(a)])
      normals.push([-Math.cos(a), -Math.sin(a)])
    }
    return { points, normals }
  }
  // Round end around `end` from the right side to the left, then around `start`
  const base = Math.atan2(dy, dx) - Math.PI / 2
  const m = 2 * arcSegments
  for (const [cx, cy, offset] of [
    [h.ex, h.ey, 0],
    [h.sx, h.sy, Math.PI],
  ] as const) {
    for (let k = 0; k <= m; k++) {
      const a = base + offset + (Math.PI * k) / m
      points.push([cx + h.radius * Math.cos(a), cy + h.radius * Math.sin(a)])
      normals.push([-Math.cos(a), -Math.sin(a)])
    }
  }
  return { points, normals }
}
