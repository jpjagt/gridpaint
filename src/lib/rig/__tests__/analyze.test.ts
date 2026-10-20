// @vitest-environment node
import { describe, it, expect } from "vitest"
import { analyzeRig, type RigInputs } from "@/lib/rig/analyze"
import { intersection, offset, isEmpty } from "@/lib/rig/clip"
import type { Layer } from "@/stores/drawingStores"
import type { PrintSetup } from "@/types/rig"

function makeLayer(id: number, points: string[]): Layer {
  return {
    id,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: `g${id}`, points: new Set(points) }],
  }
}

function block(x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`)
  return out
}

const setup: PrintSetup = {
  clearance: 0.2,
  basePlateThickness: 1.2,
  minWall: 1,
  stencilThickness: 0.6,
  glueDiameter: 1.5,
  glueMargin: 0.5,
  glueMarkers: true,
  plateOutlines: true,
  outlineDepth: 0.2,
}

// Layer 2 (in first): 5x5 block. Layer 1 on top: a plus shape.
const plus = ["2,0", "2,1", "0,2", "1,2", "2,2", "3,2", "4,2", "2,3", "2,4"]
const inputs = (extra: Partial<RigInputs> = {}): RigInputs => ({
  rect: { id: "r", minX: 0, minY: 0, maxX: 4, maxY: 4, quantity: 1 },
  layers: [makeLayer(1, plus), makeLayer(2, block(0, 0, 4, 4))],
  gridSize: 50,
  borderWidth: 0,
  mmPerUnit: 5,
  thickness: 1,
  pillars: [],
  reverse: false,
  glueSpots: [],
  setup,
  ...extra,
})

describe("analyzeRig", () => {
  it("orders the stack and finds the glue interface", () => {
    const a = analyzeRig(inputs())
    expect(a.layers.map((l) => l.layerId)).toEqual([2, 1])
    expect(a.interfaces).toHaveLength(1)
    expect(a.interfaces[0]).toMatchObject({ layerId: 2, lowerId: 1, baseLayerId: 2 })
  })

  it("suggests pillars that lock every layer, without blocking the drop-in", () => {
    const a = analyzeRig(inputs())
    expect(a.suggestedPillars.length).toBeGreaterThan(0)
    const locked = analyzeRig(inputs({ pillars: a.suggestedPillars.map(({ x, y }) => ({ x, y })) }))
    // The block locks; the plus's notches are covered by the block, so arm
    // tips are all a pillar can reach and it keeps a little rotational play
    expect(locked.locks.find((l) => l.layerId === 2)?.locked).toBe(true)
    expect(locked.locks.find((l) => l.layerId === 1)?.blockedFraction).toBeGreaterThan(0.8)
    for (const p of locked.pillars) {
      p.sections.forEach((section, k) => {
        for (let j = 0; j <= k; j++) {
          const grown = offset(locked.layers[j].footprint, setup.clearance - 0.01)
          expect(isEmpty(intersection(section, grown), 1e-3)).toBe(true)
        }
      })
    }
    // The top layer is held, so some pillar must reach it
    expect(locked.pillars.some((p) => p.touches.includes(1))).toBe(true)
  })

  it("locks a plus-on-plus stack via its notches", () => {
    const base = inputs({ layers: [makeLayer(1, plus), makeLayer(2, plus)] })
    const a = analyzeRig(base)
    const locked = analyzeRig({ ...base, pillars: a.suggestedPillars })
    expect(locked.locks.every((l) => l.locked)).toBe(true)
    expect(a.suggestedPillars.every((p) => p.touches.length === 2)).toBe(true)
    // Identical outlines: one straight wall, no hairline steps between bands
    for (const p of locked.pillars) {
      const [first, ...rest] = [...p.sections, ...(p.capSection ? [p.capSection] : [])]
      for (const section of rest) expect(section).toBe(first)
    }
  })

  it("holds every separate shape of a layer on its own", () => {
    // Layer 1: two separate 2x2 blocks; one pillar can't hold both
    const twoBlocks = [...block(0, 0, 1, 1), ...block(4, 0, 5, 1)]
    const base = inputs({
      rect: { id: "r", minX: 0, minY: 0, maxX: 5, maxY: 1, quantity: 1 },
      layers: [makeLayer(1, twoBlocks)],
    })
    const a = analyzeRig(base)
    expect(a.layers[0].pieces).toHaveLength(2)
    expect(a.locks[0]).toMatchObject({ pieces: 2, lockedPieces: 0, locked: false })
    expect(a.loosePieces).toHaveLength(2)

    // Pillars only around the left block: right block stays loose
    const leftOnly = a.suggestedPillars.filter((p) => p.x <= 2.5)
    const half = analyzeRig({ ...base, pillars: leftOnly })
    expect(half.locks[0]).toMatchObject({ lockedPieces: 1, locked: false })
    expect(half.suggestedPillars.every((p) => p.x >= 3)).toBe(true)

    const all = analyzeRig({ ...base, pillars: a.suggestedPillars })
    expect(all.locks[0]).toMatchObject({ lockedPieces: 2, locked: true })
    expect(all.loosePieces).toHaveLength(0)
  })

  it("pillars hold the layers they hug, reusing across layers", () => {
    // Next to the block's corner, away from the plus: holds only the block
    const a = analyzeRig(inputs({ pillars: [{ x: -1, y: 0 }] }))
    expect(a.pillars[0].touches).toEqual([2])
    const b = analyzeRig(inputs({ layers: [makeLayer(1, plus), makeLayer(2, plus)], pillars: [{ x: 1, y: 1 }] }))
    expect(b.pillars[0].touches).toEqual([2, 1])
  })

  it("flags glue spots outside the overlap and suggests covered ones", () => {
    const a = analyzeRig(inputs({ glueSpots: [{ layerId: 2, x: 2, y: 2 }, { layerId: 2, x: 0, y: 0 }] }))
    expect(a.glueSpots[0].issue).toBe(null)
    expect(a.glueSpots[1].issue).toBe("uncovered")
    // The placed centre spot already serves the plus-shaped overlap
    expect(a.suggestedGlueSpots).toHaveLength(0)
    const b = analyzeRig(inputs())
    expect(b.suggestedGlueSpots.length).toBeGreaterThan(0)
    const check = analyzeRig(inputs({ glueSpots: b.suggestedGlueSpots }))
    for (const s of check.glueSpots) expect(s.issue).not.toBe("uncovered")
  })
})
