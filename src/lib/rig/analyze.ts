/**
 * Assembly rig analysis: pillar cross-sections per layer band, which layers
 * each pillar holds, whether every layer is locked in place, glue spot
 * coverage, and suggestions for both.
 *
 * Drop-in rule: layer k (assembly order) must drop straight down to its
 * band, so at band k the rig must stay clear of every layer placed so far,
 * grown by the clearance. A pillar at grid point (x, y) is its cell square
 * minus that union, band by band, so it steps back as it rises.
 */

import type { Layer } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type {
  GlueInterface,
  GlueSpot,
  GlueSpotInfo,
  GlueSpotIssue,
  LayerLockStatus,
  PillarInfo,
  PrintSetup,
  Region,
  RigAnalysis,
  RigLayer,
  RigPiece,
  RigPillar,
  Vec2,
} from "@/types/rig"
import { rigLayers, SAMPLE_STEP } from "@/lib/rig/outlines"
import {
  area,
  bounds,
  contains,
  difference,
  distanceToBoundary,
  intersection,
  isEmpty,
  offset,
  pieces,
  rect as rectRegion,
  union,
} from "@/lib/rig/clip"

/** Candidate pillars extend this many cells beyond the rect */
const PILLAR_MARGIN = 2
/** How far past the clearance a wall still counts as touching (mm) */
const CONTACT_SLACK = 0.15
/** Minimum outline length a pillar must hug to hold a layer (mm) */
const MIN_CONTACT = 0.5
/** Fraction of in-plane motions that must be blocked to call a layer locked */
const LOCKED_FRACTION = 0.95
/** Gaps (beyond the clearance) at which outline samples are probed (mm) */
const GAP_PROBES = [0.03, 0.08, CONTACT_SLACK]
/** How far (beyond the clearance) a held layer may still shift (mm) */
const MAX_PLAY = 0.25
/** Steps between bands narrower than this are merged into one wall (mm) */
const HAIRLINE = 0.15
/** Glue suggestions are spaced at least this many grid units apart */
const GLUE_SPACING = 2.5
/** Smallest glue spot we suggest (mm) */
const MIN_GLUE_DIAMETER = 0.8

export interface RigInputs {
  rect: ExportRect
  layers: Layer[]
  gridSize: number
  borderWidth: number
  mmPerUnit: number
  thickness: number
  pillars: RigPillar[]
  reverse: boolean
  glueSpots: GlueSpot[]
  setup: PrintSetup
}

// --- Motion directions -----------------------------------------------------

/** Unit directions in (tx, ty, rotation) space, evenly spread on a sphere. */
const DIRECTIONS: [number, number, number][] = (() => {
  const n = 160
  const out: [number, number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - z * z)
    out.push([Math.cos(golden * i) * r, Math.sin(golden * i) * r, z])
  }
  return out
})()

interface Contact {
  p: Vec2
  n: Vec2
  /** Gap between the outline and the wall, beyond the clearance (mm) */
  gap: number
}

/**
 * Motion directions this set of contacts blocks. Moving the layer a unit
 * step along v closes the gap at a contact by v·n, so the layer can shift
 * (clearance + gap) / (v·n) before touching. It counts as blocked when
 * that stays within clearance + MAX_PLAY.
 */
function blockedBy(
  piece: RigPiece,
  contacts: Contact[],
  clearance: number,
): Uint8Array {
  const bits = new Uint8Array(DIRECTIONS.length)
  const { center: c, radius: R } = piece
  const maxShift = clearance + MAX_PLAY
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const [tx, ty, w] = DIRECTIONS[d]
    for (const { p, n, gap } of contacts) {
      // Velocity of p under translation (tx, ty) + rotation w (scaled by R)
      const vx = tx - (w * (p.y - c.y)) / R
      const vy = ty + (w * (p.x - c.x)) / R
      if (vx * n.x + vy * n.y >= (clearance + gap) / maxShift) {
        bits[d] = 1
        break
      }
    }
  }
  return bits
}

function countBits(bits: Uint8Array): number {
  let s = 0
  for (let i = 0; i < bits.length; i++) s += bits[i]
  return s
}

function orInto(target: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] |= src[i]
}

// --- Pillars ----------------------------------------------------------------

/** A piece of some layer; each is held (or not) on its own */
interface Body {
  /** Layer position in assembly order */
  band: number
  piece: RigPiece
  /** Outline samples bucketed by the grid cell they fall in */
  buckets: Map<string, RigPiece["samples"]>
}

interface Context {
  layers: RigLayer[]
  /** Every piece of every layer, in assembly order */
  bodies: Body[]
  /** Union of grown footprints of layers 0..k, per band k */
  occupied: Region[]
  mmPerUnit: number
  thickness: number
  setup: PrintSetup
}

function buildContext(inputs: RigInputs): Context {
  const layers = rigLayers(
    inputs.layers,
    inputs.rect,
    inputs.gridSize,
    inputs.borderWidth,
    inputs.mmPerUnit,
    inputs.reverse,
  )
  const occupied: Region[] = []
  let acc: Region = []
  for (const layer of layers) {
    acc = union(acc, offset(layer.footprint, inputs.setup.clearance))
    occupied.push(acc)
  }
  const m = inputs.mmPerUnit
  const bodies: Body[] = layers.flatMap((layer, band) =>
    layer.pieces.map((piece) => {
      const buckets = new Map<string, RigPiece["samples"]>()
      for (const s of piece.samples) {
        const key = `${Math.round(s.p.x / m)},${Math.round(s.p.y / m)}`
        let list = buckets.get(key)
        if (!list) buckets.set(key, (list = []))
        list.push(s)
      }
      return { band, piece, buckets }
    }),
  )
  return {
    layers,
    bodies,
    occupied,
    mmPerUnit: inputs.mmPerUnit,
    thickness: inputs.thickness,
    setup: inputs.setup,
  }
}

export function cellRegion(x: number, y: number, mmPerUnit: number): Region {
  const h = mmPerUnit / 2
  return rectRegion(x * mmPerUnit - h, y * mmPerUnit - h, x * mmPerUnit + h, y * mmPerUnit + h)
}

/** Outline samples of a body in the 3×3 cells around (x, y). */
function nearbySamples(body: Body, x: number, y: number) {
  const out: RigPiece["samples"] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const list = body.buckets.get(`${x + dx},${y + dy}`)
      if (list) out.push(...list)
    }
  return out
}

function analyzePillar(
  ctx: Context,
  x: number,
  y: number,
  placed: boolean,
): PillarInfo {
  const { layers, occupied, mmPerUnit, setup } = ctx
  const cell = cellRegion(x, y, mmPerUnit)
  const cb = bounds(cell)
  const inCell = (q: Vec2) =>
    q.x >= cb.minX && q.x <= cb.maxX && q.y >= cb.minY && q.y <= cb.maxY
  const sections: Region[] = []
  const touches: number[] = []
  const blocked = new Map<number, Uint8Array>()
  let topBand = -1

  for (let k = 0; k < layers.length; k++) {
    const section = difference(cell, occupied[k])
    if (!printable(section, setup.minWall)) break
    sections.push(section)

    ctx.bodies.forEach((body, b) => {
      if (body.band !== k) return
      const contacts: Contact[] = []
      for (const { p, n } of nearbySamples(body, x, y)) {
        for (const gap of GAP_PROBES) {
          const r = setup.clearance + gap
          const q = { x: p.x + n.x * r, y: p.y + n.y * r }
          if (inCell(q) && contains(section, q)) {
            contacts.push({ p, n, gap })
            break
          }
        }
      }
      if (contacts.length * SAMPLE_STEP >= MIN_CONTACT) {
        blocked.set(b, blockedBy(body.piece, contacts, setup.clearance))
        if (!touches.includes(layers[k].layerId)) touches.push(layers[k].layerId)
        topBand = k
      }
    })
  }

  // Stop at the highest layer held; a placed pillar holding nothing keeps
  // its first band so it still shows (and prints) as a stub.
  const keep = topBand >= 0 ? topBand + 1 : Math.min(1, sections.length)
  // The cap sits in the next band (the next layer drops past it), or on top
  // of the last layer, where nothing else comes down
  let capSection: Region | null = null
  if (keep > 0) {
    const next =
      keep < layers.length ? difference(cell, occupied[keep]) : sections[keep - 1]
    capSection = printable(next, setup.minWall) ? next : null
  }
  sections.length = keep

  // Where the layers share (nearly) the same outline, bands differ only by
  // hairline slivers from flattening their curves separately. Give the lower
  // band the upper band's section so the wall is one smooth surface; taking
  // material away never blocks a layer from dropping in.
  const stack = capSection ? [...sections, capSection] : sections
  for (let k = stack.length - 2; k >= 0; k--) {
    if (isHairline(difference(stack[k], stack[k + 1]))) stack[k] = stack[k + 1]
  }
  if (capSection) {
    capSection = stack.pop()!
    sections.splice(0, sections.length, ...stack)
  }
  const volume = sections.reduce((s, r) => s + area(r), 0) * ctx.thickness

  return { x, y, sections, touches, topBand, capSection, blocked, volume, placed }
}

/** True when a region has no part wider than HAIRLINE (or is empty). */
function isHairline(region: Region): boolean {
  return isEmpty(offset(region, -HAIRLINE / 2), 1e-4)
}

function printable(region: Region, minWall: number): boolean {
  if (isEmpty(region, minWall * minWall)) return false
  return !isEmpty(offset(region, -minWall / 2), 1e-3)
}

/** Blocked motion directions per body, from all given pillars. */
function lockStatus(ctx: Context, pillars: PillarInfo[]): Uint8Array[] {
  return ctx.bodies.map((_, b) => {
    const bits = new Uint8Array(DIRECTIONS.length)
    for (const p of pillars) {
      const blocked = p.blocked.get(b)
      if (blocked) orInto(bits, blocked)
    }
    return bits
  })
}

/**
 * Greedily add pillars until every layer is locked: each step takes the
 * candidate that blocks the most still-free motions (summed over layers)
 * for the least plastic, preferring cells away from existing pillars.
 */
function suggestPillars(
  ctx: Context,
  rect: ExportRect,
  placed: PillarInfo[],
): PillarInfo[] {
  if (ctx.layers.length === 0) return []
  const taken = new Set(placed.map((p) => `${p.x},${p.y}`))
  const candidates: PillarInfo[] = []
  for (let y = rect.minY - PILLAR_MARGIN; y <= rect.maxY + PILLAR_MARGIN; y++) {
    for (let x = rect.minX - PILLAR_MARGIN; x <= rect.maxX + PILLAR_MARGIN; x++) {
      if (taken.has(`${x},${y}`)) continue
      // Only cells next to some outline can hold anything
      if (!ctx.bodies.some((body) => nearbySamples(body, x, y).length > 0)) continue
      const info = analyzePillar(ctx, x, y, false)
      if (info.topBand >= 0) candidates.push(info)
    }
  }

  const state = lockStatus(ctx, placed)
  const D = DIRECTIONS.length
  const cellVolume = ctx.mmPerUnit * ctx.mmPerUnit * ctx.thickness
  const chosen: PillarInfo[] = []
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1

  const gain = (c: PillarInfo) => {
    let g = 0
    for (const [k, bits] of c.blocked) {
      const s = state[k]
      let added = 0
      for (let i = 0; i < D; i++) if (bits[i] && !s[i]) added++
      g += added / D
    }
    return g
  }

  for (let iter = 0; iter < 200; iter++) {
    if (state.every((s) => countBits(s) / D >= LOCKED_FRACTION)) break
    let best: PillarInfo | null = null
    let bestScore = 0
    for (const c of candidates) {
      const g = gain(c)
      if (g < 2 / D) continue
      // Neighbouring pillars are allowed (corners often need one next to a
      // side pillar) but spread-out ones are preferred
      const crowded = placed.some((p) => near(p, c)) || chosen.some((p) => near(p, c))
      // Plastic and crowding only break ties between similar gains
      const score = g - 0.003 * (c.volume / cellVolume) - (crowded ? 0.01 : 0)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
    if (!best) break
    chosen.push(best)
    for (const [k, bits] of best.blocked) orInto(state[k], bits)
  }

  // Drop suggestions the others make redundant (latest picks first).
  for (let i = chosen.length - 1; i >= 0; i--) {
    const without = [...placed, ...chosen.filter((_, j) => j !== i)]
    const before = lockStatus(ctx, [...placed, ...chosen]).map(countBits)
    const after = lockStatus(ctx, without).map(countBits)
    if (after.every((v, k) => v >= before[k])) chosen.splice(i, 1)
  }
  return chosen
}

// --- Glue -------------------------------------------------------------------

function glueInterfaces(layers: RigLayer[]): GlueInterface[] {
  const byId = [...layers].sort((a, b) => a.layerId - b.layerId)
  const out: GlueInterface[] = []
  for (let i = 1; i < byId.length; i++) {
    const lower = byId[i - 1]
    const upper = byId[i]
    const overlap = intersection(lower.footprint, upper.footprint)
    if (isEmpty(overlap)) continue
    out.push({
      layerId: upper.layerId,
      lowerId: lower.layerId,
      baseLayerId: lower.order < upper.order ? lower.layerId : upper.layerId,
      overlap,
    })
  }
  return out
}

function spotIssue(
  overlap: Region,
  c: Vec2,
  diameter: number,
  margin: number,
): GlueSpotIssue {
  const r = diameter / 2
  if (!contains(offset(overlap, -r), c)) return "uncovered"
  if (margin > 0 && !contains(offset(overlap, -(r + margin)), c)) return "tight"
  return null
}

function checkGlueSpots(
  interfaces: GlueInterface[],
  spots: GlueSpot[],
  m: number,
  setup: PrintSetup,
): GlueSpotInfo[] {
  // Cache shrunk overlaps: spots of one interface share them
  const shrunk = new Map<string, Region>()
  const shrink = (iface: GlueInterface | undefined, by: number) => {
    if (!iface) return []
    const key = `${iface.layerId}:${by}`
    let r = shrunk.get(key)
    if (!r) {
      r = offset(iface.overlap, -by)
      shrunk.set(key, r)
    }
    return r
  }
  return spots.map((s) => {
    const iface = interfaces.find((i) => i.layerId === s.layerId)
    const diameter = s.diameter ?? setup.glueDiameter
    const c = { x: s.x * m, y: s.y * m }
    const r = diameter / 2
    let issue: GlueSpotIssue = null
    if (!contains(shrink(iface, r), c)) issue = "uncovered"
    else if (!contains(shrink(iface, r + setup.glueMargin), c)) issue = "tight"
    return { layerId: s.layerId, x: s.x, y: s.y, diameter, placed: true, issue }
  })
}

/**
 * Per connected overlap area: spots on the half grid, as far inside as
 * possible, spaced apart. Tiny areas get a smaller margin, then a smaller
 * spot, and as a last resort one flagged dot at the most-inside point.
 */
function suggestGlueSpots(
  iface: GlueInterface,
  existing: GlueSpot[],
  m: number,
  setup: PrintSetup,
): GlueSpotInfo[] {
  const out: GlueSpotInfo[] = []
  const spacing = GLUE_SPACING * m
  const taken: Vec2[] = existing
    .filter((s) => s.layerId === iface.layerId)
    .map((s) => ({ x: s.x * m, y: s.y * m }))
  const d0 = setup.glueDiameter
  const attempts: [number, number][] = [
    [d0, setup.glueMargin],
    [d0, setup.glueMargin / 2],
    [d0, 0],
    [Math.max(MIN_GLUE_DIAMETER, d0 * 0.75), 0],
    [Math.max(MIN_GLUE_DIAMETER, d0 * 0.5), 0],
  ]

  for (const piece of pieces(iface.overlap)) {
    const region: Region = [piece.outer, ...piece.holes]
    const pb = bounds(region)
    const grid: Vec2[] = []
    for (let gy = Math.ceil((pb.minY / m) * 2) / 2; gy * m <= pb.maxY; gy += 0.5)
      for (let gx = Math.ceil((pb.minX / m) * 2) / 2; gx * m <= pb.maxX; gx += 0.5)
        grid.push({ x: gx * m, y: gy * m })

    // Already served by a placed spot inside this piece?
    const servedBy = taken.filter((t) => contains(region, t))

    let placedHere = false
    for (const [diameter, margin] of attempts) {
      const valid = offset(region, -(diameter / 2 + margin))
      if (isEmpty(valid, 1e-6)) continue
      const options = grid
        .filter((p) => contains(valid, p))
        .map((p) => ({ p, depth: distanceToBoundary(region, p) }))
      if (options.length === 0) continue
      const picks: Vec2[] = [...servedBy]
      // Farthest-point sampling, starting from the most interior point
      options.sort((a, b) => b.depth - a.depth)
      for (;;) {
        let best: { p: Vec2; score: number } | null = null
        for (const o of options) {
          const dmin = picks.reduce(
            (d, q) => Math.min(d, Math.hypot(q.x - o.p.x, q.y - o.p.y)),
            Infinity,
          )
          if (dmin < spacing) continue
          const score = dmin === Infinity ? o.depth : dmin + o.depth
          if (!best || score > best.score) best = { p: o.p, score }
        }
        if (!best) break
        picks.push(best.p)
        out.push({
          layerId: iface.layerId,
          x: best.p.x / m,
          y: best.p.y / m,
          diameter: diameter === d0 ? d0 : diameter,
          placed: false,
          issue: margin < setup.glueMargin || diameter < d0 ? "tight" : null,
        })
      }
      placedHere = true
      break
    }

    if (!placedHere && servedBy.length === 0 && grid.length > 0) {
      // Last resort: the most-inside half-grid point of this piece
      const inside = grid.filter((p) => contains(region, p))
      if (inside.length > 0) {
        const p = inside.reduce((a, b) =>
          distanceToBoundary(region, a) >= distanceToBoundary(region, b) ? a : b,
        )
        out.push({
          layerId: iface.layerId,
          x: p.x / m,
          y: p.y / m,
          diameter: MIN_GLUE_DIAMETER,
          placed: false,
          issue: spotIssue(region, p, MIN_GLUE_DIAMETER, 0) ?? "tight",
        })
      }
    }
  }
  return out
}

// --- Entry point -----------------------------------------------------------

export function analyzeRig(inputs: RigInputs): RigAnalysis {
  const ctx = buildContext(inputs)
  const m = inputs.mmPerUnit
  const pillars = inputs.pillars.map((p) => analyzePillar(ctx, p.x, p.y, true))
  const suggestedPillars = suggestPillars(ctx, inputs.rect, pillars)

  const state = lockStatus(ctx, pillars)
  const fraction = (b: number) => countBits(state[b]) / DIRECTIONS.length
  const locks: LayerLockStatus[] = ctx.layers.map((layer, k) => {
    const own = ctx.bodies.map((_, b) => b).filter((b) => ctx.bodies[b].band === k)
    const lockedPieces = own.filter((b) => fraction(b) >= LOCKED_FRACTION).length
    return {
      layerId: layer.layerId,
      blockedFraction: Math.min(1, ...own.map(fraction)),
      locked: lockedPieces === own.length,
      pieces: own.length,
      lockedPieces,
    }
  })
  const loosePieces = ctx.bodies
    .filter((_, b) => fraction(b) < LOCKED_FRACTION)
    .map((body) => ({
      layerId: ctx.layers[body.band].layerId,
      footprint: body.piece.footprint,
    }))

  const interfaces = glueInterfaces(ctx.layers)
  const ids = new Set(interfaces.map((i) => i.layerId))
  const { rect } = inputs
  const relevantSpots = inputs.glueSpots.filter(
    (s) =>
      ids.has(s.layerId) &&
      s.x >= rect.minX - 0.5 && s.x <= rect.maxX + 0.5 &&
      s.y >= rect.minY - 0.5 && s.y <= rect.maxY + 0.5,
  )
  const glueSpots = checkGlueSpots(interfaces, relevantSpots, m, inputs.setup)
  const suggestedGlueSpots = interfaces.flatMap((i) => suggestGlueSpots(i, relevantSpots, m, inputs.setup))

  return {
    rectId: inputs.rect.id,
    mmPerUnit: m,
    thickness: inputs.thickness,
    layers: ctx.layers,
    pillars,
    suggestedPillars,
    locks,
    loosePieces,
    interfaces,
    glueSpots,
    suggestedGlueSpots,
  }
}
