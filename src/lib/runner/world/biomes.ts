/**
 * Biomes. Each fills one slice (a 2D cut at distance `zt`) with cells.
 * Ground and the walkway are added by the generator, not here.
 *
 * Coordinates: col 0 is the path, rows count up from the ground (row 0 is
 * the first row above ground), zt is distance along the path in tiles.
 */

import type {
  Biome,
  BiomeId,
  SliceContext,
  SliceGrid,
  Structure,
  StructureFactory,
  StructureFieldOptions,
  WorldGenParams,
} from "@/types/runner"
import { MIN_ROW } from "../config"
import { SimplexNoise, makeRng, rand3, smoothstep } from "../noise"
import {
  StructureField,
  block,
  castle,
  floating,
  gate,
  makeStructure,
  monolith,
  obelisk,
  orb,
  pole,
  ring,
  stampStructures,
  temple,
  tower,
  ziggurat,
} from "./structures"

const scratch: Structure[] = []

function weighted(rng: () => number, options: [number, StructureFactory][]): StructureFactory {
  const total = options.reduce((s, [w]) => s + w, 0)
  let r = rng() * total
  for (const [w, f] of options) {
    if ((r -= w) < 0) return f
  }
  return options[options.length - 1][1]
}

function mix(options: [number, StructureFactory][]): StructureFactory {
  return (rng, cx, cz) => weighted(rng, options)(rng, cx, cz)
}

class FieldSet {
  private fields: StructureField[] = []

  constructor(private params: WorldGenParams, private baseId: number) {}

  add(opts: Partial<StructureFieldOptions> & { factory: StructureFactory }) {
    this.fields.push(
      new StructureField(
        {
          spacingX: 20,
          spacingZ: 20,
          probability: 0.5,
          minPathDistance: 0,
          onPath: false,
          ...opts,
        },
        this.params.seed,
        this.baseId * 16 + this.fields.length,
        this.params.halfWidth,
        this.params.sliceDepth,
        this.params.doorHeight,
      ),
    )
    return this
  }

  stamp(grid: SliceGrid, zt: number) {
    scratch.length = 0
    for (const f of this.fields) f.query(zt, scratch)
    stampStructures(grid, scratch, zt)
  }
}

const stump: StructureFactory = (rng, cx, cz) => {
  const h = 1 + Math.floor(rng() * 4)
  const dz = rng() < 0.5 ? 0.5 : 1
  return makeStructure(cx, cz, 0, dz, 0, h, 4, (lx, row, lz) => lx === 0 && row >= 0 && row < h && lz <= dz)
}

// === Desert: near-empty dunes, lonely needles and monoliths =================

class DesertBiome implements Biome {
  id: BiomeId = "desert"
  ground = 1
  private fields: FieldSet
  private noise: SimplexNoise

  constructor(params: WorldGenParams) {
    this.noise = new SimplexNoise(params.seed + 11)
    this.fields = new FieldSet(params, 1)
      .add({
        spacingX: 26,
        spacingZ: 26,
        probability: 0.22,
        minPathDistance: 3,
        factory: mix([
          [0.45, obelisk],
          [0.3, monolith],
          [0.1, gate],
          [0.15, (rng, cx, cz) => block(1 + Math.floor(rng() * 2), cx, cz)],
        ]),
      })
      .add({ onPath: true, spacingZ: 130, probability: 0.35, factory: gate })
  }

  fill(ctx: SliceContext, grid: SliceGrid) {
    const { cols, halfWidth, cells } = grid
    for (let col = -halfWidth; col <= halfWidth; col++) {
      const n = this.noise.fbm2(col / 32, ctx.zt / 32, 2)
      const h = Math.floor((n - 0.3) * 5)
      for (let row = 0; row < h; row++) cells[(row - MIN_ROW) * cols + col + halfWidth] = 1
    }
    this.fields.stamp(grid, ctx.zt)
  }
}

// === Ruins: temples, ziggurats, castles, gates over the path ================

class RuinsBiome implements Biome {
  id: BiomeId = "ruins"
  ground = 1
  private fields: FieldSet
  private noise: SimplexNoise

  constructor(params: WorldGenParams) {
    this.noise = new SimplexNoise(params.seed + 23)
    this.fields = new FieldSet(params, 2)
      .add({
        spacingX: 30,
        spacingZ: 34,
        probability: 0.6,
        minPathDistance: 8,
        factory: mix([
          [0.35, ziggurat],
          [0.3, temple],
          [0.15, castle],
          [0.2, obelisk],
        ]),
      })
      .add({
        onPath: true,
        spacingZ: 60,
        probability: 0.5,
        factory: mix([
          [0.45, gate],
          [0.3, temple],
          [0.25, castle],
        ]),
      })
      .add({ spacingX: 9, spacingZ: 9, probability: 0.12, minPathDistance: 2, factory: stump })
  }

  fill(ctx: SliceContext, grid: SliceGrid) {
    const { cols, halfWidth, cells } = grid
    const base = -MIN_ROW * cols + halfWidth
    for (let col = -halfWidth; col <= halfWidth; col++) {
      const n = this.noise.fbm2(col * 0.22, ctx.zt * 0.22, 2)
      if (n > 0.64) cells[base + col] = 1
      if (n > 0.76) cells[base + cols + col] = 1
    }
    this.fields.stamp(grid, ctx.zt)
  }
}

// === Dream: warped noise blobs, orbs, rings; sometimes mirrored =============

class DreamBiome implements Biome {
  id: BiomeId = "dream"
  ground = 0
  private fields: FieldSet
  private noise: SimplexNoise
  private warp: SimplexNoise
  private seed: number

  constructor(params: WorldGenParams) {
    this.seed = params.seed
    this.noise = new SimplexNoise(params.seed + 37)
    this.warp = new SimplexNoise(params.seed + 41)
    const seed = params.seed
    // Rings come in rhythmic runs: whole 100-tile segments share one ring shape
    const ringRun: StructureFactory = (_rng, cx, cz) => {
      const seg = Math.floor(cz / 100)
      if (rand3(seg, 7, 0, seed) > 0.45) return null
      return ring(makeRng(seed ^ (seg * 7919)), cx, cz)
    }
    const lifted = (f: StructureFactory, minLift: number, maxLift: number, flipChance: number): StructureFactory =>
      (rng, cx, cz) => {
        const s = f(rng, cx, cz)
        if (!s) return null
        const lift = minLift + Math.floor(rng() * (maxLift - minLift + 1))
        return floating(s, lift, rng() < flipChance)
      }
    this.fields = new FieldSet(params, 3)
      .add({
        spacingX: 20,
        spacingZ: 20,
        probability: 0.45,
        minPathDistance: 4,
        factory: mix([
          [0.3, orb],
          [0.2, lifted(ziggurat, 6, 14, 0.7)],
          [0.15, lifted(temple, 8, 16, 0.6)],
          [0.15, lifted(gate, 3, 12, 0.3)],
          [0.1, lifted((rng, cx, cz) => block(2 + Math.floor(rng() * 3), cx, cz), 2, 18, 0)],
          [0.1, lifted(obelisk, 4, 14, 0.5)],
        ]),
      })
      .add({ onPath: true, spacingZ: 12, probability: 1, factory: ringRun })
  }

  private density(col: number, row: number, z: number): number {
    const w = this.warp.noise3(col * 0.02, row * 0.03, z * 0.02) * 2
    return this.noise.fbm3(col * 0.035 + w, row * 0.06, z * 0.03 - w, 2)
  }

  fill(ctx: SliceContext, grid: SliceGrid) {
    const { cols, halfWidth, cells } = grid
    const zt = ctx.zt
    const top = Math.min(MIN_ROW + grid.rows - 1, 26)

    // Segment-level symmetry modes, faded in/out so slices stay continuous
    const segLen = 90
    const seg = Math.floor(zt / segLen)
    const into = zt - seg * segLen
    const fade = smoothstep(0, 12, into) * smoothstep(segLen, segLen - 12, into)
    const mirrorX = rand3(seg, 1, 0, this.seed) < 0.5 ? fade : 0
    const palindrome = rand3(seg, 2, 0, this.seed) < 0.3 ? fade : 0
    const mid = seg * segLen + segLen / 2
    const zMirror = mid - Math.abs(zt - mid)

    for (let row = MIN_ROW; row <= top; row++) {
      const base = (row - MIN_ROW) * cols + halfWidth
      // thinner at the top and bottom of the band, emptier near the path
      const band = 0.5 + 0.12 * Math.abs(row - 10) / 12
      for (let col = -halfWidth; col <= halfWidth; col++) {
        const pathClear = 0.35 * Math.exp(-(col * col + (row - 2) * (row - 2)) / 20)
        const thr = band + pathClear
        let v = this.density(col, row, zt)
        if (mirrorX > 0) v += (this.density(Math.abs(col), row, zt) - v) * mirrorX
        if (palindrome > 0) v += (this.density(col, row, zMirror) - v) * palindrome
        if (v > thr) cells[base + col] = 1
      }
    }
    this.fields.stamp(grid, zt)
  }
}

// === Plains: flat, regular, repeated — frames, poles, a far grid of cubes ===

class PlainsBiome implements Biome {
  id: BiomeId = "plains"
  ground = 1
  private seed: number

  constructor(params: WorldGenParams) {
    this.seed = params.seed
  }

  fill(ctx: SliceContext, grid: SliceGrid) {
    const zt = ctx.zt
    // Parameters stay constant for long stretches: that's the point
    const seg = Math.floor(zt / 300)
    const rng = makeRng(this.seed ^ Math.imul(seg + 1, 0x51ed27))
    const frameSpacing = [6, 8, 12, 16][Math.floor(rng() * 4)]
    const frameW = 2 + Math.floor(rng() * 5)
    const frameH = 5 + Math.floor(rng() * 4)
    const frames = rng() < 0.7
    const poleX = 6 + Math.floor(rng() * 6)
    const poleSpacing = [8, 10, 14][Math.floor(rng() * 3)]
    const poleH = 6 + Math.floor(rng() * 4)
    const poles = rng() < 0.6
    const grid0 = [10, 14, 18][Math.floor(rng() * 3)]
    const cubeSize = 1 + Math.floor(rng() * 2)

    const list: Structure[] = []
    const near = (spacing: number) => {
      const k = Math.round(zt / spacing)
      return k * spacing
    }
    if (frames) list.push(frameAt(frameW, frameH, near(frameSpacing)))
    if (poles) {
      const cz = near(poleSpacing)
      list.push(pole(poleH, poleX, cz, 2), pole(poleH, -poleX, cz, 2))
    }
    const cz = near(grid0)
    for (let cx = grid0 * 2; cx <= grid.halfWidth; cx += grid0) {
      list.push(block(cubeSize, cx, cz), block(cubeSize, -cx, cz))
    }
    stampStructures(grid, list, zt)
  }
}

function frameAt(w: number, h: number, cz: number): Structure {
  return makeStructure(0, cz, w + 1, 0.5, 0, h + 1, 4, (lx, row, lz) => {
    if (lz > 0.5 || row < 0 || row > h) return false
    return lx === w || row === h
  })
}

// === Megacity: tower blocks receding into fog, skybridges over the path ====

class MegacityBiome implements Biome {
  id: BiomeId = "megacity"
  ground = 1
  private fields: FieldSet

  constructor(params: WorldGenParams) {
    const skybridge: StructureFactory = (rng, cx, cz) => {
      const w = 5 + Math.floor(rng() * 6)
      const h = 8 + Math.floor(rng() * 6)
      const t = 1 + Math.floor(rng() * 2)
      const dz = rng() < 0.5 ? 1 : 2
      return makeStructure(cx, cz, w + 2, dz, 0, h + t, 4, (lx, row, lz) => {
        if (lz > dz || row < 0) return false
        if (row >= h && row < h + t) return lx <= w + 2
        return row < h && lx >= w && lx <= w + 2
      })
    }
    this.fields = new FieldSet(params, 5)
      .add({ spacingX: 11, spacingZ: 12, probability: 0.6, minPathDistance: 6, factory: tower })
      .add({ onPath: true, spacingZ: 45, probability: 0.45, factory: skybridge })
  }

  fill(ctx: SliceContext, grid: SliceGrid) {
    this.fields.stamp(grid, ctx.zt)
  }
}

export function createBiomes(params: WorldGenParams): Record<BiomeId, Biome> {
  return {
    desert: new DesertBiome(params),
    ruins: new RuinsBiome(params),
    dream: new DreamBiome(params),
    plains: new PlainsBiome(params),
    megacity: new MegacityBiome(params),
  }
}
