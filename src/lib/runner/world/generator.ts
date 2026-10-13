/**
 * WorldGenerator: deterministic slice generation for an endless path.
 *
 * The path is split into zones of roughly `zoneLength` tiles, each with one
 * biome. Around each zone boundary the two biomes cross-fade through a 3D
 * noise mask, so structures dissolve into the next landscape rather than
 * being cut off. Ground likewise erodes into the walkway when entering a
 * groundless biome.
 */

import type {
  Biome,
  BiomeId,
  SliceGrid,
  WorldGenParams,
  ZoneSample,
} from "@/types/runner"
import { MIN_ROW } from "../config"
import { SimplexNoise, rand3, smoothstep } from "../noise"
import { createBiomes } from "./biomes"
import { createSliceGrid } from "./grid"

const BIOME_ORDER: BiomeId[] = ["desert", "ruins", "dream", "plains", "megacity"]

export class WorldGenerator {
  readonly params: WorldGenParams
  private biomes: Record<BiomeId, Biome>
  private zoneBiomes: BiomeId[] = []
  private mask: SimplexNoise
  private groundNoise: SimplexNoise
  private tmpA: SliceGrid
  private tmpB: SliceGrid
  private loopA: SliceGrid
  private loopB: SliceGrid

  constructor(params: WorldGenParams) {
    this.params = params
    this.biomes = createBiomes(params)
    this.mask = new SimplexNoise(params.seed + 101)
    this.groundNoise = new SimplexNoise(params.seed + 103)
    this.tmpA = createSliceGrid(params.halfWidth, params.maxRow)
    this.tmpB = createSliceGrid(params.halfWidth, params.maxRow)
    this.loopA = createSliceGrid(params.halfWidth, params.maxRow)
    this.loopB = createSliceGrid(params.halfWidth, params.maxRow)
  }

  createGrid(): SliceGrid {
    return createSliceGrid(this.params.halfWidth, this.params.maxRow)
  }

  /** Start of zone n, in tiles */
  zoneStart(n: number): number {
    const L = this.params.zoneLength
    if (n <= 0) return n * L
    return n * L + (rand3(n, 0, 3, this.params.seed) - 0.5) * L * 0.5
  }

  zoneBiome(n: number): BiomeId {
    if (n < 0) n = 0
    const weights = this.params.biomeWeights
    const enabled = BIOME_ORDER.filter((b) => weights[b] > 0)
    if (enabled.length === 0) return "desert"
    while (this.zoneBiomes.length <= n) {
      const i = this.zoneBiomes.length
      // Open on the emptiest landscape when it's enabled
      if (i === 0) {
        this.zoneBiomes.push(weights.desert > 0 ? "desert" : enabled[0])
        continue
      }
      const prev = this.zoneBiomes[i - 1]
      const options = enabled.length > 1 ? enabled.filter((b) => b !== prev) : enabled
      const total = options.reduce((s, b) => s + weights[b], 0)
      let r = rand3(i, 1, 3, this.params.seed) * total
      let pick = options[options.length - 1]
      for (const b of options) {
        if ((r -= weights[b]) < 0) {
          pick = b
          break
        }
      }
      this.zoneBiomes.push(pick)
    }
    return this.zoneBiomes[n]
  }

  zoneAt(zt: number): ZoneSample {
    const L = this.params.zoneLength
    let n = Math.max(0, Math.floor(zt / L))
    while (n > 0 && this.zoneStart(n) > zt) n--
    while (this.zoneStart(n + 1) <= zt) n++

    const half = this.params.transitionLength / 2
    const start = this.zoneStart(n)
    const end = this.zoneStart(n + 1)
    const here = this.biomes[this.zoneBiome(n)]
    if (n > 0 && zt < start + half) {
      return {
        from: this.biomes[this.zoneBiome(n - 1)],
        to: here,
        t: smoothstep(start - half, start + half, zt),
      }
    }
    if (zt > end - half) {
      return {
        from: here,
        to: this.biomes[this.zoneBiome(n + 1)],
        t: smoothstep(end - half, end + half, zt),
      }
    }
    return { from: here, to: here, t: 0 }
  }

  /**
   * Fill `grid` with slice k (k = 0 is the first slice ahead of the start).
   * With a loop length set, the world repeats and its last stretch
   * cross-fades into the slices just before the start, so the wrap is seamless.
   */
  fillSlice(k: number, grid: SliceGrid): void {
    const d = this.params.sliceDepth
    const period = Math.round(this.params.loopLength / d)
    if (period <= 0) {
      this.fillRaw(k, grid)
      return
    }
    const kk = ((k % period) + period) % period
    const zt = (kk + 0.5) * d
    const L = period * d
    const fadeLen = Math.min(this.params.transitionLength, L / 3)
    if (zt <= L - fadeLen) {
      this.fillRaw(kk, grid)
      return
    }
    const a = this.loopA
    const b = this.loopB
    this.fillRaw(kk, a)
    this.fillRaw(kk - period, b)
    this.blend(a, b, smoothstep(L - fadeLen, L, zt), zt, grid)
  }

  /** Per cell, take b where the 3D mask is below t (organic cross-fade) */
  private blend(a: SliceGrid, b: SliceGrid, t: number, zt: number, out: SliceGrid) {
    const { cols, halfWidth } = out
    for (let row = MIN_ROW; row < MIN_ROW + out.rows; row++) {
      const base = (row - MIN_ROW) * cols + halfWidth
      for (let col = -halfWidth; col <= halfWidth; col++) {
        const i = base + col
        if (a.cells[i] === b.cells[i]) {
          out.cells[i] = a.cells[i]
          continue
        }
        const m = this.mask.noise3(col * 0.11, row * 0.11, zt * 0.11) * 0.5 + 0.5
        out.cells[i] = m < t ? b.cells[i] : a.cells[i]
      }
    }
  }

  private fillRaw(k: number, grid: SliceGrid): void {
    const { cols, halfWidth, cells } = grid
    const zt = (k + 0.5) * this.params.sliceDepth
    const ctx = { k, zt }
    const zone = this.zoneAt(zt)

    cells.fill(0)
    if (zone.from === zone.to || zone.t <= 0 || zone.t >= 1) {
      const biome = zone.t >= 1 ? zone.to : zone.from
      biome.fill(ctx, grid)
    } else {
      const a = this.tmpA
      const b = this.tmpB
      a.cells.fill(0)
      b.cells.fill(0)
      zone.from.fill(ctx, a)
      zone.to.fill(ctx, b)
      this.blend(a, b, zone.t, zt, grid)
    }

    // Ground: solid when the biome wants it, eroding into islands otherwise
    const groundAmt = zone.from.ground + (zone.to.ground - zone.from.ground) * zone.t
    const g0 = (-1 - MIN_ROW) * cols + halfWidth
    const g1 = (-2 - MIN_ROW) * cols + halfWidth
    if (groundAmt >= 0.999) {
      for (let col = -halfWidth; col <= halfWidth; col++) {
        cells[g0 + col] = 1
        cells[g1 + col] = 1
      }
    } else if (groundAmt > 0.001) {
      for (let col = -halfWidth; col <= halfWidth; col++) {
        const n = this.groundNoise.fbm2(col * 0.08, zt * 0.08, 2) * 0.5 + 0.5
        if (n < groundAmt) {
          cells[g0 + col] = 1
          cells[g1 + col] = 1
        }
      }
    }
    // The walkway is always there
    cells[g0] = 1

    for (const [col, row] of this.params.tunnels) {
      if (col >= -halfWidth && col <= halfWidth && row >= MIN_ROW && row < MIN_ROW + grid.rows) {
        cells[(row - MIN_ROW) * cols + col + halfWidth] = 0
      }
    }
  }

  biomeNameAt(zt: number): string {
    const L = this.params.loopLength
    if (L > 0) zt = ((zt % L) + L) % L
    const z = this.zoneAt(zt)
    if (z.from === z.to || z.t <= 0) return z.from.id
    if (z.t >= 1) return z.to.id
    return `${z.from.id} → ${z.to.id}`
  }
}
