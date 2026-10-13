/**
 * Procedural structures: placed on a jittered lattice, deterministic per
 * seed, optionally mirror-symmetric. `contains` receives coordinates
 * relative to the structure centre, already folded for symmetry (so a
 * 2-fold structure only has to describe lx >= 0).
 */

import type {
  SliceGrid,
  Structure,
  StructureFieldOptions,
} from "@/types/runner"
import { MIN_ROW } from "../config"
import { CELL_METAL } from "../mesher"
import { hash3, makeRng, rand3 } from "../noise"

type Contains = Structure["contains"]

export function makeStructure(
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  bottom: number,
  top: number,
  symmetry: 0 | 2 | 4,
  contains: Contains,
): Structure {
  return { cx, cz, hx, hz, bottom, top, symmetry, contains }
}

const ri = (rng: () => number, a: number, b: number) =>
  a + Math.floor(rng() * (b - a + 1))
const pick = <T>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)]

// === Shapes ===================================================================

/** Tall thin needle, sometimes with a wider plinth */
export function obelisk(rng: () => number, cx: number, cz: number): Structure {
  const h = ri(rng, 7, 24)
  const plinth = rng() < 0.5 ? ri(rng, 1, 2) : 0
  const dz = pick(rng, [0.5, 0.5, 1, 1.5])
  return makeStructure(cx, cz, 2, dz + 1, 0, h, 4, (lx, row, lz) => {
    if (row < 0 || row >= h) return false
    if (row < plinth) return lx <= 1 && lz <= dz + 1
    return lx === 0 && lz <= dz
  })
}

/** Flat upright slab — the lonely monolith */
export function monolith(rng: () => number, cx: number, cz: number): Structure {
  const w = ri(rng, 1, 3)
  const h = ri(rng, 6, 16)
  return makeStructure(cx, cz, w, 0.5, 0, h, 4, (lx, row, lz) => {
    return row >= 0 && row < h && lx <= w && lz <= 0.5
  })
}

/** Gate over the path (centre on cx = 0 to run through it) */
export function gate(rng: () => number, cx: number, cz: number): Structure {
  const w = ri(rng, 2, 5) // half-width of the opening
  const h = ri(rng, 6, 11) // opening height
  const post = ri(rng, 1, 2)
  const lintel = ri(rng, 1, 2)
  const crown = rng() < 0.5 ? ri(rng, 2, 4) : 0
  const dz = pick(rng, [0.5, 1, 1, 2])
  const hollow = rng() < 0.3
  const outer = w + post
  return makeStructure(cx, cz, outer + 1, dz, 0, h + lintel + crown, 4, (lx, row, lz) => {
    if (lz > dz || row < 0) return false
    if (row < h) {
      if (lx < w || lx >= outer) return false
      return !(hollow && lz < dz - 0.5 && row > 0 && row < h - 1)
    }
    if (row < h + lintel) return lx <= outer
    // stepped crown narrowing towards the top
    return row < h + lintel + crown && lx <= outer - 1 - (row - h - lintel) * 2
  })
}

/** Stepped pyramid with a passage through its base */
export function ziggurat(rng: () => number, cx: number, cz: number): Structure {
  const levels = ri(rng, 3, 7)
  const stepH = ri(rng, 1, 3)
  const stepIn = ri(rng, 1, 2)
  const r = levels * stepIn + ri(rng, 1, 4)
  const shrine = rng() < 0.6
  const passage = rng() < 0.6
  const top = levels * stepH + (shrine ? 3 : 0)
  return makeStructure(cx, cz, r + 1, r + 1, 0, top, 4, (lx, row, lz) => {
    if (row < 0) return false
    if (passage && lx === 0 && row < 2) return false
    const level = Math.floor(row / stepH)
    if (level < levels) {
      const ext = r - level * stepIn
      return lx <= ext && lz <= ext
    }
    if (!shrine) return false
    const ext = r - levels * stepIn
    const s = row - levels * stepH
    return s < 3 && lx <= Math.max(0, ext - 1) && lz <= Math.max(0.5, ext - 1) && !(s === 1 && lx === 0)
  })
}

/** Temple: platform, colonnades, roof with stepped pediment */
export function temple(rng: () => number, cx: number, cz: number): Structure {
  const r = ri(rng, 2, 6) // column x-offset from the centre
  const len = ri(rng, 4, 12) // half length along z
  const h = ri(rng, 4, 8)
  const spacing = pick(rng, [2, 2, 3])
  const roof = rng() < 0.75
  return makeStructure(cx, cz, r + 3, len + 1, 0, h + 2 + r, 4, (lx, row, lz) => {
    if (row < 0) return false
    if (row === 0) return lx <= r + 1 && lz <= len + 1
    if (row < h) {
      if (lx !== r) return false
      const m = lz % spacing
      return m < 0.5 && lz <= len
    }
    if (!roof) return false
    if (row < h + 2) return lx <= r + 1 && lz <= len + 0.5
    return lx <= r + 1 - (row - h - 2) * 2 && lz <= len
  })
}

/** Castle courtyard: two crenellated walls, corner towers, gated end walls */
export function castle(rng: () => number, cx: number, cz: number): Structure {
  const r = ri(rng, 3, 7) // wall x-offset
  const len = ri(rng, 8, 16)
  const h = ri(rng, 5, 9)
  const towerH = h + ri(rng, 3, 6)
  const gateW = ri(rng, 1, Math.max(1, r - 2))
  const gateH = Math.min(h - 1, ri(rng, 4, 7))
  const endWalls = rng() < 0.7
  return makeStructure(cx, cz, r + 3, len + 2, 0, towerH + 1, 4, (lx, row, lz) => {
    if (row < 0) return false
    // corner towers
    if (lx >= r - 1 && lx <= r + 2 && lz >= len - 1.5 && lz <= len + 1.5) {
      if (row < towerH) return true
      return row === towerH && (lx === r - 1 || lx === r + 2)
    }
    // side walls with crenellations
    if (lx >= r && lx <= r + 1 && lz <= len) {
      if (row < h) return true
      return row === h && Math.floor(lz) % 2 === 0
    }
    // end walls with a gate
    if (endWalls && lz >= len - 0.5 && lz <= len && lx < r) {
      if (lx < gateW && row < gateH) return false
      return row < h
    }
    return false
  })
}

/** Tower block with setbacks and floor grooves */
export function tower(rng: () => number, cx: number, cz: number): Structure {
  const w = ri(rng, 1, 4)
  const d = ri(rng, 1, 4)
  const h = ri(rng, 9, 22) + Math.floor(Math.abs(cx) * 0.12)
  const setback = rng() < 0.5 ? Math.floor(h * (0.55 + rng() * 0.25)) : h
  const grooves = rng() < 0.5 ? ri(rng, 3, 5) : 0
  const antenna = rng() < 0.35 ? ri(rng, 2, 5) : 0
  return makeStructure(cx, cz, w + 1, d + 1, 0, h + antenna, 4, (lx, row, lz) => {
    if (row < 0) return false
    if (row >= h) return lx === 0 && lz <= 0.5 && row < h + antenna
    let ww = w
    let dd = d
    if (row >= setback) {
      ww = Math.max(0, w - 1)
      dd = Math.max(0.5, d - 1)
    }
    if (grooves && row % grooves === grooves - 1 && row < setback) ww -= 1
    return lx <= ww && lz <= dd
  })
}

/** Floating sphere-ish blob */
export function orb(rng: () => number, cx: number, cz: number): Structure {
  const r = 1.5 + rng() * 4
  const cy = ri(rng, 2, 16)
  const r2 = r * r
  return makeStructure(cx, cz, Math.ceil(r), r, Math.floor(cy - r), Math.ceil(cy + r), 4, (lx, row, lz) => {
    const dy = row + 0.5 - cy
    return lx * lx + dy * dy + lz * lz < r2
  })
}

/** Ring around the path (centre it on cx = 0) */
export function ring(rng: () => number, cx: number, cz: number): Structure {
  const R = 4 + rng() * 6
  const th = 0.7 + rng() * 0.6
  const cy = Math.max(R - 1.5, 3 + rng() * 3)
  const dz = pick(rng, [0.5, 0.5, 1])
  return makeStructure(cx, cz, Math.ceil(R + th), dz, Math.floor(cy - R - th), Math.ceil(cy + R + th), 4, (lx, row, lz) => {
    if (lz > dz) return false
    const dy = row + 0.5 - cy
    const d = Math.sqrt(lx * lx + dy * dy)
    return Math.abs(d - R) < th
  })
}

/** Thin pole (lamp-post / power line feel) */
export function pole(h: number, cx: number, cz: number, arm: number): Structure {
  return makeStructure(cx, cz, arm + 1, 0.5, 0, h + 1, 0, (lx, row, lz) => {
    if (Math.abs(lz) > 0.5 || row < 0) return false
    if (lx === 0) return row < h
    // arm points toward the path
    const towardPath = cx > 0 ? -lx : lx
    return row === h - 1 && towardPath > 0 && towardPath <= arm
  })
}

/** Rectangular frame spanning the path */
export function frame(w: number, h: number, cx: number, cz: number): Structure {
  return makeStructure(cx, cz, w + 1, 0.5, 0, h + 1, 4, (lx, row, lz) => {
    if (lz > 0.5 || row < 0 || row > h) return false
    return lx === w || row === h
  })
}

/** Small cube */
export function block(size: number, cx: number, cz: number, lift = 0): Structure {
  const half = (size - 1) / 2
  return makeStructure(cx, cz, Math.ceil(half), size / 2, lift, lift + size, 4, (lx, row, lz) => {
    return lx <= half && lz <= size / 2 && row >= lift && row < lift + size
  })
}

/** Lift a structure off the ground, optionally hanging it upside down */
export function floating(s: Structure, lift: number, flip: boolean): Structure {
  const { bottom, top } = s
  return makeStructure(s.cx, s.cz, s.hx, s.hz, bottom + lift, top + lift, s.symmetry, (lx, row, lz) => {
    const local = row - lift
    return s.contains(lx, flip ? top + bottom - local : local, lz)
  })
}

// === Placement ================================================================

/**
 * Jittered lattice of structures, generated lazily per lattice row along Z
 * and cached (rows we've passed are dropped).
 */
export class StructureField {
  private rows = new Map<number, Structure[]>()
  private lowestKept = -Infinity

  constructor(
    private opts: StructureFieldOptions,
    private seed: number,
    private fieldId: number,
    private halfWidth: number,
    private sliceDepth: number,
    private doorHeight: number,
    private metalFraction: number,
  ) {}

  /** Structures whose Z extent covers zt */
  query(zt: number, out: Structure[]): Structure[] {
    const { spacingZ } = this.opts
    const m = Math.floor(zt / spacingZ)
    for (let mm = m - 2; mm <= m + 2; mm++) {
      for (const s of this.row(mm)) {
        if (Math.abs(zt - s.cz) <= s.hz + 0.01) out.push(s)
      }
    }
    // forget rows well behind us
    if (m - 4 > this.lowestKept) {
      for (const key of this.rows.keys()) if (key < m - 4) this.rows.delete(key)
      this.lowestKept = m - 4
    }
    return out
  }

  private row(m: number): Structure[] {
    let list = this.rows.get(m)
    if (list) return list
    list = []
    const { spacingX, spacingZ, probability, minPathDistance, onPath, factory } = this.opts
    const nMax = onPath ? 0 : Math.ceil(this.halfWidth / spacingX) + 1
    for (let n = -nMax; n <= nMax; n++) {
      const rng = makeRng(hash3(n, m, this.fieldId, this.seed))
      if (rng() >= probability) continue
      let cx = onPath ? 0 : Math.round(n * spacingX + (rng() - 0.5) * spacingX * 0.6)
      if (!onPath && Math.abs(cx) < minPathDistance) {
        cx = cx < 0 || (cx === 0 && rng() < 0.5) ? -minPathDistance : minPathDistance
      }
      let cz = m * spacingZ + spacingZ / 2 + (rng() - 0.5) * spacingZ * 0.6
      // Snap to a slice boundary so Z-mirrored shapes are exactly symmetric
      cz = Math.round(cz / this.sliceDepth) * this.sliceDepth
      const s = factory(rng, cx, cz)
      if (!s) continue
      // separate hash, so changing the metal share never changes the shapes
      s.metal = rand3(n, m, this.fieldId + 7777, this.seed) < this.metalFraction
      if (onPath) {
        const door = withDoorway(s, this.doorHeight)
        door.metal = s.metal
        list.push(door)
      } else {
        // Off-path structures never cover the path (±1 column)
        if (s.cx - s.hx <= 1 && s.cx + s.hx >= -1) {
          s.cx = s.cx >= 0 ? s.hx + 2 : -s.hx - 2
        }
        list.push(s)
      }
    }
    this.rows.set(m, list)
    return list
  }
}

/** Cut a 3-wide doorway through a structure that sits across the path */
export function withDoorway(s: Structure, height: number): Structure {
  const inner = s.contains
  const cx = s.cx
  return makeStructure(s.cx, s.cz, s.hx, s.hz, s.bottom, s.top, s.symmetry, (lx, row, lz) => {
    // lx may be folded; recover the true column offset from the path
    const fromPath = Math.abs(cx + lx) <= 1 || (s.symmetry !== 0 && Math.abs(cx - lx) <= 1)
    if (fromPath && row >= 0 && row < height) return false
    return inner(lx, row, lz)
  })
}

/** OR the given structures into a slice */
export function stampStructures(grid: SliceGrid, structures: Structure[], zt: number) {
  const { cols, halfWidth, cells } = grid
  const maxRow = MIN_ROW + grid.rows - 1
  for (const s of structures) {
    const value = s.metal ? CELL_METAL : 1
    let lz = zt - s.cz
    if (s.symmetry === 4) lz = Math.abs(lz)
    const c0 = Math.max(-halfWidth, s.cx - s.hx)
    const c1 = Math.min(halfWidth, s.cx + s.hx)
    const r0 = Math.max(MIN_ROW, s.bottom)
    const r1 = Math.min(maxRow, s.top)
    for (let row = r0; row <= r1; row++) {
      const base = (row - MIN_ROW) * cols + halfWidth
      for (let col = c0; col <= c1; col++) {
        let lx = col - s.cx
        if (s.symmetry !== 0) lx = Math.abs(lx)
        if (s.contains(lx, row, lz)) cells[base + col] = value
      }
    }
  }
}
