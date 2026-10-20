/**
 * Printable parts of an assembly rig: the rig body (base plate + stepped
 * pillars, with engraved glue markers) and one glue stencil per layer
 * interface. Everything is in mm, z up, the floor at z = 0.
 */

import * as THREE from "three"
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type {
  GlueSpotInfo,
  PillarInfo,
  PrintSetup,
  Region,
  RigAnalysis,
  Vec2,
} from "@/types/rig"
import {
  bounds,
  circle,
  contains,
  difference,
  isEmpty,
  offset,
  pieces,
  union,
} from "@/lib/rig/clip"
import { basePlate } from "@/lib/rig/plate"

/** Outline grooves on the base plate: width and depth (mm) */
const OUTLINE_WIDTH = 0.5
const OUTLINE_DEPTH = 0.4
/** Glue markers point at spots at most this many cells away */
const MARKER_REACH = 4
/** Marker triangle size (circumradius, mm) */
const MARKER_RADIUS = 0.9

export interface RigPart {
  name: string
  geometry: THREE.BufferGeometry
}

interface Slab {
  z0: number
  z1: number
  region: Region
}

export function buildRigParts(
  analysis: RigAnalysis,
  setup: PrintSetup,
  reverse: boolean,
): RigPart[] {
  const { layers, pillars, thickness: t } = analysis
  const b = setup.basePlateThickness
  const bandTop = (k: number) => b + (k + 1) * t
  const cap = Math.min(setup.stencilThickness, t)
  const m = analysis.mmPerUnit

  // --- Rig body ---
  const slabs: Slab[] = []
  for (const pillar of pillars) {
    const markers = setup.glueMarkers ? pillarMarkers(pillar, analysis) : []
    // A marker for band k is a slot from the pillar top down to layer k's top
    const cutAbove = (band: number) =>
      union(...markers.filter((mk) => mk.band < band).map((mk) => mk.triangle))
    pillar.sections.forEach((section, k) => {
      const z0 = k === 0 ? 0 : bandTop(k - 1)
      slabs.push({ z0, z1: bandTop(k), region: difference(section, cutAbove(k)) })
    })
    if (pillar.capSection && pillar.sections.length > 0) {
      const top = bandTop(pillar.sections.length - 1)
      slabs.push({
        z0: top,
        z1: top + cap,
        region: difference(pillar.capSection, cutAbove(pillar.sections.length)),
      })
    }
  }

  const everything = union(
    ...layers.map((l) => l.footprint),
    ...pillars.map((p) => p.sections[0] ?? []),
  )
  const plate = basePlate(everything)
  if (plate.length > 0) {
    // Shape outlines as shallow grooves in the plate's top, centred on each
    // edge so they show as a line around every piece
    const grooves = setup.plateOutlines
      ? union(
          ...layers.map((l) =>
            difference(
              offset(l.footprint, OUTLINE_WIDTH / 2),
              offset(l.footprint, -OUTLINE_WIDTH / 2),
            ),
          ),
        )
      : []
    const depth = Math.min(OUTLINE_DEPTH, b / 3)
    if (grooves.length > 0) {
      slabs.push({ z0: 0, z1: b - depth, region: plate })
      slabs.push({ z0: b - depth, z1: b, region: difference(plate, grooves) })
    } else {
      slabs.push({ z0: 0, z1: b, region: plate })
    }
  }

  const parts: RigPart[] = []
  const transform = (p: Vec2) => ({ x: reverse ? -p.x : p.x, y: -p.y })
  const rig = slabsToGeometry(slabs, transform)
  if (rig) parts.push({ name: "rig", geometry: rig })

  // --- Glue stencils, laid out beside the rig ---
  rig?.computeBoundingBox()
  let shiftX = rig?.boundingBox ? rig.boundingBox.max.x + 5 : 0
  for (const iface of analysis.interfaces) {
    const spots = analysis.glueSpots.filter((s) => s.layerId === iface.layerId)
    if (spots.length === 0) continue
    const base = layers.find((l) => l.layerId === iface.baseLayerId)
    if (!base) continue
    const holes = union(
      ...spots.map((s) => circle({ x: s.x * m, y: s.y * m }, s.diameter / 2)),
    )
    const plate = difference(base.footprint, holes)
    const geom = slabsToGeometry(
      [{ z0: 0, z1: setup.stencilThickness, region: plate }],
      transform,
    )
    if (!geom) continue
    geom.computeBoundingBox()
    const bb = geom.boundingBox!
    geom.translate(shiftX - bb.min.x, 0, 0)
    shiftX += bb.max.x - bb.min.x + 5
    const other = iface.baseLayerId === iface.layerId ? iface.lowerId : iface.layerId
    parts.push({
      name: `glue stencil ${iface.baseLayerId} (then ${other})`,
      geometry: geom,
    })
  }
  return parts
}

// --- Glue markers ----------------------------------------------------------

interface Marker {
  band: number
  triangle: Region
}

/**
 * For each layer a pillar holds that receives glue, a triangular slot
 * pointing at the nearest glue spot within reach. The slot runs from the
 * pillar top down to that layer's top surface, so it is visible from above
 * while gluing, and its depth tells which layer it belongs to.
 */
function pillarMarkers(pillar: PillarInfo, analysis: RigAnalysis): Marker[] {
  const m = analysis.mmPerUnit
  const center = { x: pillar.x * m, y: pillar.y * m }
  // The slot must fit in the pillar's narrowest (top) section
  const top = pillar.capSection ?? pillar.sections[pillar.sections.length - 1]
  if (!top) return []
  const out: Marker[] = []
  pillar.sections.forEach((_, k) => {
    // A slot needs pillar material above layer k
    if (k === pillar.sections.length - 1 && !pillar.capSection) return
    const layerId = analysis.layers[k]?.layerId
    if (!pillar.touches.includes(layerId)) return
    const ifaces = analysis.interfaces.filter((i) => i.baseLayerId === layerId)
    const spots: GlueSpotInfo[] = analysis.glueSpots.filter((s) =>
      ifaces.some((i) => i.layerId === s.layerId),
    )
    let target: Vec2 | null = null
    let best = MARKER_REACH * m
    for (const s of spots) {
      const p = { x: s.x * m, y: s.y * m }
      const d = Math.hypot(p.x - center.x, p.y - center.y)
      if (d < best) {
        best = d
        target = p
      }
    }
    if (!target) return

    const taken = union(...out.map((mk) => offset(mk.triangle, 0.4)))
    const at = placeMarker(difference(top, taken), target)
    if (at) out.push({ band: k, triangle: triangle(at, target) })
  })
  return out
}

/** Point nearest the target where a marker fits with a wall around it. */
function placeMarker(face: Region, target: Vec2): Vec2 | null {
  const room = offset(face, -(MARKER_RADIUS + 0.4))
  if (isEmpty(room, 1e-4)) return null
  const bb = bounds(room)
  let best: Vec2 | null = null
  let bestD = Infinity
  const step = 0.2
  for (let y = bb.minY; y <= bb.maxY; y += step)
    for (let x = bb.minX; x <= bb.maxX; x += step) {
      const p = { x, y }
      if (!contains(room, p)) continue
      const d = Math.hypot(target.x - x, target.y - y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
  return best
}

function triangle(at: Vec2, toward: Vec2): Region {
  const a = Math.atan2(toward.y - at.y, toward.x - at.x)
  const r = MARKER_RADIUS
  const pt = (angle: number, rad: number) => ({
    x: at.x + Math.cos(angle) * rad,
    y: at.y + Math.sin(angle) * rad,
  })
  // A narrow arrowhead: tip at full radius, base corners closer in
  return union([[pt(a, r), pt(a + 2.4, r * 0.75), pt(a - 2.4, r * 0.75)]])
}

// --- Meshing ----------------------------------------------------------------

function slabsToGeometry(
  slabs: Slab[],
  transform: (p: Vec2) => Vec2,
): THREE.BufferGeometry | null {
  const geoms: THREE.BufferGeometry[] = []
  for (const slab of slabs) {
    const height = slab.z1 - slab.z0
    if (height <= 1e-6) continue
    const shapes = pieces(slab.region).map((piece) => {
      const shape = new THREE.Shape(
        piece.outer.map(transform).map((p) => new THREE.Vector2(p.x, p.y)),
      )
      shape.holes = piece.holes.map(
        (h) => new THREE.Path(h.map(transform).map((p) => new THREE.Vector2(p.x, p.y))),
      )
      return shape
    })
    if (shapes.length === 0) continue
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
    })
    g.translate(0, 0, slab.z0)
    g.deleteAttribute("uv")
    g.deleteAttribute("normal")
    geoms.push(g)
  }
  if (geoms.length === 0) return null
  const merged = mergeVertices(mergeGeometries(geoms), 1e-5)
  merged.computeVertexNormals()
  return merged
}
