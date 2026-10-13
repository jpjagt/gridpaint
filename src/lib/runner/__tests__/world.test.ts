import { describe, it, expect } from "vitest"
import { DEFAULT_RUNNER_CONFIG, cloneConfig, toWorldGenParams } from "@/lib/runner/config"
import { buildChunkMesh } from "@/lib/runner/mesher"
import { WorldGenerator } from "@/lib/runner/world/generator"
import { createSliceGrid, getCell, setCell } from "@/lib/runner/world/grid"
import type { BiomeId, SliceGrid } from "@/types/runner"

const params = () => toWorldGenParams(cloneConfig(DEFAULT_RUNNER_CONFIG))

function sliceRange(gen: WorldGenerator, k0: number, n: number): SliceGrid[] {
  const out: SliceGrid[] = []
  for (let k = k0 - 1; k < k0 + n; k++) {
    const g = gen.createGrid()
    gen.fillSlice(k, g)
    out.push(g)
  }
  return out
}

describe("world generator", () => {
  it("is deterministic", () => {
    const a = new WorldGenerator(params())
    const b = new WorldGenerator(params())
    for (const k of [0, 17, 999, 5000]) {
      const ga = a.createGrid()
      const gb = b.createGrid()
      a.fillSlice(k, ga)
      b.fillSlice(k, gb)
      expect(ga.cells).toEqual(gb.cells)
    }
  })

  it("keeps the tunnels open and the walkway solid everywhere", () => {
    const p = params()
    const gen = new WorldGenerator(p)
    const g = gen.createGrid()
    for (let k = 0; k < 6000; k += 7) {
      gen.fillSlice(k, g)
      for (const [col, row] of p.tunnels) expect(getCell(g, col, row)).toBe(0)
      expect(getCell(g, 0, -1)).toBe(1)
    }
  })

  it("visits every enabled biome", () => {
    const gen = new WorldGenerator(params())
    const seen = new Set<BiomeId>()
    for (let n = 0; n < 40; n++) seen.add(gen.zoneBiome(n))
    expect(seen.size).toBe(5)
    for (let n = 1; n < 40; n++) expect(gen.zoneBiome(n)).not.toBe(gen.zoneBiome(n - 1))
  })
})

describe("loop mode", () => {
  it("repeats exactly and wraps without a jump", () => {
    const p = { ...params(), loopLength: 120, biomeWeights: { desert: 0, ruins: 1, dream: 0, plains: 0, megacity: 0 } }
    const gen = new WorldGenerator(p)
    const period = 120 / p.sliceDepth
    const at = (k: number) => {
      const g = gen.createGrid()
      gen.fillSlice(k, g)
      return g.cells
    }
    for (const k of [0, 5, 100, period - 1]) expect(at(k + period)).toEqual(at(k))
    const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0)
    let worst = 0
    for (let k = 1; k < period; k++) worst = Math.max(worst, diff(at(k - 1), at(k)))
    expect(diff(at(period - 1), at(period))).toBeLessThanOrEqual(worst)
  })
})

describe("chunk mesher", () => {
  it("draws a front only where the slice in front doesn't cover it", () => {
    const grids = Array.from({ length: 5 }, () => createSliceGrid(4, 4))
    // a 2x2 block present in slices 1..4 (index 0 is the slice before the chunk)
    for (const g of grids.slice(1)) {
      setCell(g, 0, 1, 1)
      setCell(g, 1, 1, 1)
      setCell(g, 0, 2, 1)
      setCell(g, 1, 2, 1)
    }
    const mesh = buildChunkMesh(grids, 0.5, 4)
    const zs = new Set<number>()
    for (let i = 2; i < mesh.fronts.length; i += 3) zs.add(mesh.fronts[i])
    expect([...zs].map(Math.abs)).toEqual([0])
    // walls merged along z: every wall vertex at z = 0 or the chunk's back
    for (let i = 2; i < mesh.sides.length; i += 3) expect([0, -2]).toContain(mesh.sides[i])
    expect(mesh.outlines.length).toBeGreaterThan(0)
    // 3 internal boundaries with identical shapes → seams
    const seamZs = new Set<number>()
    for (let i = 2; i < mesh.seams.length; i += 3) seamZs.add(mesh.seams[i])
    expect([...seamZs].sort((a, b) => a - b)).toEqual([-1.5, -1, -0.5])
  })

  it("benchmarks generation + meshing per chunk", () => {
    const p = params()
    const gen = new WorldGenerator(p)
    const results: string[] = []
    // sample a range that crosses several biomes
    for (const chunk of [0, 40, 80, 120, 125, 130, 160, 200, 240, 280]) {
      const t0 = performance.now()
      const slices = sliceRange(gen, chunk * p.chunkSlices, p.chunkSlices)
      const t1 = performance.now()
      const mesh = buildChunkMesh(slices, p.sliceDepth, 6, 42)
      const t2 = performance.now()
      const far = buildChunkMesh(slices, p.sliceDepth, 2)
      const zt = chunk * p.chunkSlices * p.sliceDepth
      let filled = 0
      for (const sl of slices) for (const c of sl.cells) filled += c
      const fill = ((100 * filled) / (slices.length * slices[0].cells.length)).toFixed(1)
      results.push(
        `chunk ${chunk} (${gen.biomeNameAt(zt)}): gen ${(t1 - t0).toFixed(1)}ms mesh ${(t2 - t1).toFixed(1)}ms ` +
          `fill ${fill}% near: tris ${(mesh.fronts.length + mesh.sides.length) / 9} (fronts ${mesh.fronts.length / 9}) ` +
          `lines ${(mesh.outlines.length + mesh.seams.length) / 6} | far: tris ${(far.fronts.length + far.sides.length) / 9} ` +
          `lines ${(far.outlines.length + far.seams.length) / 6}`,
      )
    }
    console.log(results.join("\n"))
  })
})
