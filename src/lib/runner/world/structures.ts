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
  const giant = rng() < 0.2
  const h = giant ? ri(rng, 35, 80) : ri(rng, 8, 30)
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
  const giant = rng() < 0.15
  const w = giant ? ri(rng, 3, 7) : ri(rng, 1, 3)
  const h = giant ? ri(rng, 30, 60) : ri(rng, 8, 24)
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
  const levels = ri(rng, 3, 10)
  const stepH = ri(rng, 2, 5)
  const stepIn = levels > 6 ? 1 : ri(rng, 1, 2)
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
  const h = ri(rng, 6, 18)
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
  const h = ri(rng, 7, 16)
  const towerH = h + ri(rng, 4, 14)
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
  // Taller further from the path; now and then a very tall slender spire
  const spire = rng() < 0.15
  const h = spire
    ? ri(rng, 60, 98)
    : ri(rng, 15, 45) + Math.floor(Math.abs(cx) * 0.25)
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

// --- Forest -----------------------------------------------------------------

/** Broadleaf tree: trunk with a blobby ellipsoid crown */
export function tree(rng: () => number, cx: number, cz: number): Structure {
  const trunk = ri(rng, 3, 9)
  const r = 2 + rng() * 3.5
  const ry = r * (0.6 + rng() * 0.3)
  const cy = trunk + ry * 0.7
  const thick = rng() < 0.25
  return makeStructure(cx, cz, Math.ceil(r), r, 0, Math.ceil(cy + ry), 4, (lx, row, lz) => {
    if (row < 0) return false
    if (row < trunk && (lx === 0 || (thick && lx <= 1 && row < 2)) && lz <= (thick ? 1 : 0.5)) return true
    const dy = (row + 0.5 - cy) / ry
    return (lx * lx + lz * lz) / (r * r) + dy * dy < 1
  })
}

/**
 * Looming giant: tall trunk flaring into roots, a huge flattened crown, and
 * lianas hanging from under the crown.
 */
export function giantTree(rng: () => number, cx: number, cz: number): Structure {
  const trunk = ri(rng, 16, 50)
  const tr = 0.5 + rng() * 1.5 // trunk radius
  const r = 6 + rng() * 8
  const ry = r * (0.35 + rng() * 0.25)
  const cy = trunk + ry * 0.5
  const salt = Math.floor(rng() * 1e6)
  const vineChance = 0.05 + rng() * 0.1
  const crownBottom = cy - ry * 0.7
  return makeStructure(cx, cz, Math.ceil(r), r, 0, Math.ceil(cy + ry), 4, (lx, row, lz) => {
    if (row < 0) return false
    const d = Math.sqrt(lx * lx + lz * lz)
    // trunk, flaring out into roots near the ground
    const flare = row < 4 ? (4 - row) * 0.9 : 0
    if (row < cy && d <= tr + flare) return true
    const dy = (row + 0.5 - cy) / ry
    if ((lx * lx + lz * lz) / (r * r) + dy * dy < 1) return true
    // lianas: thin strands hanging from under the crown
    if (row < crownBottom && d < r * 0.85 && d > tr + 1) {
      const lzq = Math.round(lz)
      if (Math.abs(lz - lzq) > 0.3) return false
      const h = hash3(lx, lzq, salt, 911)
      if (h / 4294967296 < vineChance) {
        const len = 4 + ((h >>> 8) % 22)
        return row >= crownBottom - len
      }
    }
    return false
  })
}

/** Conifer: thin trunk, stacked tiers narrowing to a point */
export function pine(rng: () => number, cx: number, cz: number): Structure {
  const giant = rng() < 0.3
  const trunk = giant ? ri(rng, 4, 10) : ri(rng, 1, 3)
  const tiers = giant ? ri(rng, 6, 12) : ri(rng, 3, 6)
  const tierH = giant ? ri(rng, 3, 6) : ri(rng, 2, 3)
  const r0 = giant ? 4 + rng() * 4 : 2 + rng() * 2.5
  const h = trunk + tiers * tierH
  return makeStructure(cx, cz, Math.ceil(r0), r0, 0, h + 1, 4, (lx, row, lz) => {
    if (row < 0 || row > h) return false
    if (row < trunk) return lx === 0 && lz <= 0.5
    const t = row - trunk
    const tier = Math.floor(t / tierH)
    // each tier flares out at its bottom; the whole tree narrows upward
    const taper = 1 - tier / tiers
    const flare = 1 - (t % tierH) / (tierH * 1.6)
    const rr = r0 * taper * flare
    return Math.sqrt(lx * lx + lz * lz) <= Math.max(0.4, rr)
  })
}

// --- Industrial ---------------------------------------------------------------

/** Pipes running along the path (long in Z); bundles of a few, maybe mirrored */
export function pipeRun(rng: () => number, cx: number, cz: number): Structure {
  const len = ri(rng, 20, 70)
  const count = ri(rng, 1, 4)
  const r = pick(rng, [0.5, 0.5, 1, 1.5])
  const gap = Math.ceil(r * 2) + 1
  const cy = ri(rng, -10, 12)
  const vertical = rng() < 0.5
  const span = (count - 1) * gap
  // flanges: rings every few tiles, the rhythm you see running past
  const flangeEvery = pick(rng, [0, 3, 4, 6])
  return makeStructure(cx, cz, Math.ceil(r) + (vertical ? 0 : span), len / 2, cy - Math.ceil(r) - (vertical ? span : 0), cy + Math.ceil(r), 0, (lx, row, lz) => {
    if (Math.abs(lz) > len / 2) return false
    const flange = flangeEvery > 0 && ((lz % flangeEvery) + flangeEvery) % flangeEvery < 0.5
    const rr = flange ? r + 0.7 : r
    for (let i = 0; i < count; i++) {
      const px = vertical ? 0 : i * gap
      const py = vertical ? cy - i * gap : cy
      const dx = lx - px
      const dy = row + 0.5 - (py + 0.5)
      if (dx * dx + dy * dy <= rr * rr + 0.01) return true
    }
    return false
  })
}

/** Vertical tank rising from the void, with a domed top */
export function tank(rng: () => number, cx: number, cz: number): Structure {
  const r = 2 + rng() * 3
  const h = ri(rng, 2, 18)
  const bottom = MIN_ROW
  const dome = rng() < 0.6
  return makeStructure(cx, cz, Math.ceil(r), r, bottom, h + Math.ceil(r), 4, (lx, row, lz) => {
    const d2 = lx * lx + lz * lz
    if (row < h) return row >= bottom && d2 <= r * r
    if (!dome) return false
    const dy = row - h + 0.5
    return d2 + dy * dy * 2 <= r * r
  })
}

/** Cooling tower: hyperboloid waist, open at the top */
export function coolingTower(rng: () => number, cx: number, cz: number): Structure {
  const h = ri(rng, 30, 75)
  const r0 = 6 + rng() * 7
  const waist = 0.6 + rng() * 0.15
  const wall = 1.2
  const bottom = MIN_ROW
  return makeStructure(cx, cz, Math.ceil(r0), r0, bottom, h, 4, (lx, row, lz) => {
    if (row < bottom || row >= h) return false
    const t = (row - bottom) / (h - bottom)
    const rr = r0 * (waist + (1 - waist) * Math.pow(2 * t - 1.1, 2))
    const d = Math.sqrt(lx * lx + lz * lz)
    return d <= rr && d >= rr - wall
  })
}

/**
 * Long wall running alongside the path (mirrored on both sides): buttresses
 * at a fixed rhythm, horizontal bands, windows in a grid.
 */
export function ribbedWall(rng: () => number, cx: number, cz: number): Structure {
  const off = ri(rng, 6, 20) // distance from the path
  const len = ri(rng, 30, 80)
  const h = ri(rng, 10, 50)
  const thick = ri(rng, 1, 3)
  const ribEvery = pick(rng, [3, 4, 6, 8])
  const rib = ri(rng, 1, 2)
  const band = ri(rng, 4, 9)
  const windows = rng() < 0.6
  return makeStructure(0, cz, off + thick + rib + 1, len / 2, MIN_ROW, h, 4, (lx, row, lz) => {
    if (lz > len / 2 || row >= h) return false
    const inWall = lx >= off && lx < off + thick
    const phase = lz % ribEvery
    if (inWall) {
      if (windows && thick > 1 && row % band > 1 && row % band < band - 1 && phase > 1 && phase < ribEvery - 1)
        return lx === off + thick - 1 // recessed window: only the back layer
      return true
    }
    // buttresses on the outside face, and a ledge at every band
    if (lx >= off + thick && lx < off + thick + rib) return phase < 1 || row % band === 0
    return false
  })
}

/** Tall thin smokestack rising from the void, banded */
export function chimney(rng: () => number, cx: number, cz: number): Structure {
  const h = ri(rng, 40, 95)
  const r = 1 + rng() * 1.2
  const band = ri(rng, 6, 12)
  return makeStructure(cx, cz, Math.ceil(r) + 1, r + 1, MIN_ROW, h, 4, (lx, row, lz) => {
    if (row >= h) return false
    const d2 = lx * lx + lz * lz
    const rr = row % band === 0 ? r + 0.8 : r
    return d2 <= rr * rr
  })
}

/** Very tall thin mast with crossbars (radio tower on the horizon) */
export function mast(rng: () => number, cx: number, cz: number): Structure {
  const h = ri(rng, 50, 98)
  const every = ri(rng, 8, 16)
  const arm = ri(rng, 1, 3)
  return makeStructure(cx, cz, arm + 1, 0.5, 0, h, 4, (lx, row, lz) => {
    if (lz > 0.5 || row < 0 || row >= h) return false
    if (lx === 0) return true
    return row % every === every - 1 && lx <= arm
  })
}

/** Machine block rising from the void: a box with setbacks and vents */
export function machine(rng: () => number, cx: number, cz: number): Structure {
  const t = tower(rng, cx, cz)
  const vents = rng() < 0.6
  const top = ri(rng, 2, 30)
  const ribEvery = pick(rng, [0, 2, 3])
  const inner = t.contains
  // the tower's cross-sections, stretched from the void up to `top`
  return makeStructure(t.cx, t.cz, t.hx + 1, t.hz + 1, MIN_ROW, top, t.symmetry, (lx, row, lz) => {
    if (row > top) return false
    if (vents && row % 3 === 0 && lx >= t.hx - 2) return false
    if (inner(lx, Math.min(row - MIN_ROW, t.top - 1), lz)) return true
    // vertical ribs repeating along the path
    return ribEvery > 0 && Math.floor(lz) % ribEvery === 0 && inner(Math.max(0, lx - 1), Math.min(row - MIN_ROW, t.top - 1), Math.max(0, lz - 1)) && lz % 1 < 0.5
  })
}

/** Pipe or gantry crossing over the path (long in X) */
export function crossPipe(rng: () => number, cx: number, cz: number): Structure {
  const h = ri(rng, 5, 14)
  const w = ri(rng, 6, 30)
  const r = pick(rng, [0.5, 1])
  const legs = rng() < 0.5
  return makeStructure(cx, cz, w + 1, r + 0.5, MIN_ROW, h + Math.ceil(r), 4, (lx, row, lz) => {
    if (lz > r + 0.5) return false
    const dy = row + 0.5 - (h + 0.5)
    if (lx <= w && dy * dy + lz * lz <= r * r + 0.01) return true
    // support legs down into the void at the ends
    return legs && lx === w && row <= h && lz <= 0.5
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
