import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { TiledLayerGeometry } from "@/lib/blob-engine/TiledLayerGeometry"
import type { BlobPrimitive, GridLayer } from "@/lib/blob-engine/types"
import type { PointModifications, QuadrantState } from "@/types/gridpaint"

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const STATES: QuadrantState[] = ["full", "empty", "convex-nw", "concave-se", "convex-ne", "concave-sw"]

function randomLayer(rnd: () => number, groups: number, withMods: boolean, half: boolean): GridLayer {
  const size = 40
  const gs = Array.from({ length: groups }, (_, i) => ({
    id: `g${i}`,
    points: new Set<string>(),
    offsetPhaseX: half && i === 1 ? ("half" as const) : undefined,
    offsetPhaseY: half && i === 1 ? ("half" as const) : undefined,
  }))
  for (let y = -size / 2; y < size; y++)
    for (let x = -size / 2; x < size; x++)
      if (rnd() < 0.5) gs[Math.floor(rnd() * groups)].points.add(`${x},${y}`)
  const mods = new Map<string, PointModifications>()
  if (withMods) {
    for (let i = 0; i < 40; i++) {
      const key = `${Math.floor(rnd() * size)},${Math.floor(rnd() * size)}`
      mods.set(key, { quadrantOverrides: { [Math.floor(rnd() * 4)]: STATES[Math.floor(rnd() * STATES.length)] } })
    }
  }
  return {
    id: 1,
    groups: gs,
    isVisible: true,
    renderStyle: "default",
    pointModifications: mods.size ? mods : undefined,
  }
}

/** Immutable edit like the store makes: a few cells toggled in one group */
function edit(rnd: () => number, layer: GridLayer): GridLayer {
  const gi = Math.floor(rnd() * layer.groups.length)
  const points = new Set(layer.groups[gi].points)
  const cx = Math.floor(rnd() * 60) - 20
  const cy = Math.floor(rnd() * 60) - 20
  for (let i = 0; i < 5; i++) {
    const key = `${cx + Math.floor(rnd() * 3)},${cy + Math.floor(rnd() * 3)}`
    if (points.has(key)) points.delete(key)
    else points.add(key)
  }
  let pointModifications = layer.pointModifications
  if (pointModifications && rnd() < 0.5) {
    pointModifications = new Map(pointModifications)
    pointModifications.set(`${cx},${cy}`, { quadrantOverrides: { 2: "concave-nw" } })
  }
  return {
    ...layer,
    groups: layer.groups.map((g, i) => (i === gi ? { ...g, points } : g)),
    pointModifications,
  }
}

const canon = (ps: BlobPrimitive[]) =>
  ps
    .map((p) => `${p.type}@${p.center.x},${p.center.y}:${p.quadrant}/${p.renderQuadrant ?? "-"}/${p.curveType}`)
    .sort()

describe("TiledLayerGeometry", () => {
  const cases = [
    { name: "single group", groups: 1, mods: false, half: false },
    { name: "single group + overrides", groups: 1, mods: true, half: false },
    { name: "multi group + half offset + overrides", groups: 3, mods: true, half: true },
  ]
  for (const c of cases) {
    it(`matches full regeneration after incremental edits (${c.name})`, () => {
      const rnd = rng(7)
      const engine = new BlobEngine()
      const tiled = new TiledLayerGeometry(engine)
      let layer = randomLayer(rnd, c.groups, c.mods, c.half)
      for (let step = 0; step < 25; step++) {
        const got = tiled.update(layer, 50, 0)
        const want = new BlobEngine().generateLayerGeometry(layer, 50, 0)
        expect(canon(got.primitives)).toEqual(canon(want.primitives))
        layer = edit(rnd, layer)
      }
    })
  }

  it("keeps the identity of tiles an edit doesn't touch", () => {
    const rnd = rng(3)
    const tiled = new TiledLayerGeometry(new BlobEngine())
    const layer = randomLayer(rnd, 1, false, false)
    const before = tiled.update(layer, 50, 0).tiles!
    const points = new Set(layer.groups[0].points)
    points.add("0,0")
    points.delete("0,0") // ensure a change even if it existed
    points.add("1,1")
    const after = tiled.update({ ...layer, groups: [{ ...layer.groups[0], points }] }, 50, 0).tiles!
    const far = [...after.entries()].filter(([k]) => k === "2,2")
    expect(far).toHaveLength(1)
    for (const [k, t] of far) expect(before.get(k)).toBe(t)
  })
})
