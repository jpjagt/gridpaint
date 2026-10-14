/**
 * Mesh assertions for comparing the tile mesher with the legacy extrusion:
 * cap area, bounds, watertightness (with orientation) and normal direction.
 */

import * as THREE from "three"
import { planLayerMesh } from "@/lib/threejs/blobPieces"
import { TileMeshBuilder } from "@/lib/threejs/tileMesher"
import { createLegacyLayerGeometry } from "@/lib/threejs/LayeredModel"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { LayerMeshPlan } from "@/types/threejs"

function triangles(geo: THREE.BufferGeometry): number[][] {
  const idx = geo.index
  const n = idx ? idx.count : geo.attributes.position.count
  const out: number[][] = []
  for (let i = 0; i < n; i += 3) {
    out.push(idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2])
  }
  return out
}

/** Projected area of the triangles facing +z at the top of the solid */
export function frontCapArea(geo: THREE.BufferGeometry, zTop = 1): number {
  const pos = geo.attributes.position
  let area = 0
  for (const [a, b, c] of triangles(geo)) {
    if ([a, b, c].some((k) => Math.abs(pos.getZ(k) - zTop) > 1e-6)) continue
    const cross =
      (pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) -
      (pos.getY(b) - pos.getY(a)) * (pos.getX(c) - pos.getX(a))
    if (cross > 0) area += cross / 2
  }
  return area
}

export function positionBounds(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox()
  return geo.boundingBox!.clone()
}

/**
 * Oriented watertightness: after welding vertices by position, every edge
 * must be used equally often in both directions. Returns the number of
 * unbalanced edges (0 = closed and consistently oriented).
 */
export function unbalancedEdgeCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position
  const key = (i: number) =>
    `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`
  const counts = new Map<string, number>()
  for (const tri of triangles(geo)) {
    const k = tri.map(key)
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue
    for (let e = 0; e < 3; e++) {
      const a = k[e]
      const b = k[(e + 1) % 3]
      const id = a < b ? `${a}|${b}` : `${b}|${a}`
      counts.set(id, (counts.get(id) ?? 0) + (a < b ? 1 : -1))
    }
  }
  let bad = 0
  for (const c of counts.values()) if (c !== 0) bad++
  return bad
}

/**
 * Triangles whose winding disagrees with their vertex normals (the
 * geometric normal and the averaged vertex normal point apart).
 */
export function invertedTriangleCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  let bad = 0
  for (const [i, j, k] of triangles(geo)) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, j)
    c.fromBufferAttribute(pos, k)
    const face = b.sub(a).cross(c.sub(a))
    if (face.lengthSq() < 1e-14) continue
    n.set(
      nor.getX(i) + nor.getX(j) + nor.getX(k),
      nor.getY(i) + nor.getY(j) + nor.getY(k),
      nor.getZ(i) + nor.getZ(j) + nor.getZ(k),
    )
    if (face.dot(n) <= 0) bad++
  }
  return bad
}

/** Signed volume (positive for a closed solid with outward winding) */
export function signedVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let v = 0
  for (const [i, j, k] of triangles(geo)) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, j)
    c.fromBufferAttribute(pos, k)
    v += a.dot(b.clone().cross(c)) / 6
  }
  return v
}

export interface MeshPair {
  plan: LayerMeshPlan
  tiles: THREE.BufferGeometry | null
  legacy: THREE.BufferGeometry | null
}

/** Mesh one layer (one unit thick) with both pipelines */
export function meshLayerBothWays(
  layer: GridLayer,
  { includeCutouts = true, mmPerUnit = 1, arcSegments = 16 } = {},
): MeshPair {
  const plan = planLayerMesh(layer, { includeCutouts, mmPerUnit })
  let tiles: THREE.BufferGeometry | null = null
  if (plan.kind === "tiles") {
    const builder = new TileMeshBuilder()
    builder.addLayer(plan.grid, plan.regions, {
      z0: 0,
      color: [1, 1, 1],
      scale: scaleToFactor(layer.scale),
      arcSegments,
    })
    const buffers = builder.finish()
    tiles = new THREE.BufferGeometry()
    tiles.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3))
    tiles.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3))
    tiles.setIndex(new THREE.BufferAttribute(buffers.indices, 1))
  }
  const legacy = createLegacyLayerGeometry(layer, 50, 2, includeCutouts, mmPerUnit)
  return { plan, tiles, legacy }
}
