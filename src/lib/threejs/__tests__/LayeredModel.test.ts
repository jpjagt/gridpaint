/**
 * Tests for createLayeredModel stacking order.
 *
 * 2D compositing is bottom-to-top (6→1): layer 1 is the visual top. The 3D
 * viewer camera looks from +Z, so by default layer 1 must end up at the
 * highest z (nearest the camera) for the model to match the drawing;
 * reverseLayers=true shows the back of the physical stack (mirrored view).
 */

import { describe, it, expect } from "vitest"
import * as THREE from "three"
import { createLayeredModel, updateLayerThickness } from "@/lib/threejs/LayeredModel"
import { DEFAULT_LAYER_RANGE } from "@/types/layers"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

// Per-layer grey tints from LayeredModel's getLayerGrey (as linear vertex
// colours) — used to identify which vertices belong to which layer.
const LAYER_1_GREY = 0xf5f5f5
const LAYER_2_GREY = 0xe8e8e8

function makeLayer(id: number, points: string[]): Layer {
  return {
    id,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: `g${id}`, points: new Set(points) }],
  }
}

const exportRect: ExportRect = {
  id: "r1",
  minX: 0,
  minY: 0,
  maxX: 10,
  maxY: 10,
  quantity: 1,
}

const canvasView: CanvasViewState = {
  gridSize: 50,
  borderWidth: 2,
  panOffset: { x: 0, y: 0 },
  zoom: 1,
  mmPerUnit: 1,
  layerRange: DEFAULT_LAYER_RANGE,
}

function layerMeshes(group: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o)
  })
  return meshes
}

/** World-space z range of the vertices carrying a layer's grey */
function zRangeByColor(group: THREE.Group, hex: number): [number, number] {
  const target = new THREE.Color(hex)
  group.updateMatrixWorld(true)
  let lo = Infinity
  let hi = -Infinity
  const v = new THREE.Vector3()
  for (const mesh of layerMeshes(group)) {
    const pos = mesh.geometry.attributes.position
    const col = mesh.geometry.attributes.color
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(col.getX(i) - target.r) > 1e-6) continue
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      lo = Math.min(lo, v.z)
      hi = Math.max(hi, v.z)
    }
  }
  expect(lo).toBeLessThan(Infinity)
  return [lo, hi]
}

describe("createLayeredModel stacking order", () => {
  const layers = [makeLayer(1, ["2,2"]), makeLayer(2, ["2,2"])]

  it("puts layer 1 nearest the camera (highest z) by default, matching 2D top layer", () => {
    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness: 1,
      reverseLayers: false,
    })
    expect(result).not.toBeNull()
    const [lo1, hi1] = zRangeByColor(result!.group, LAYER_1_GREY)
    const [lo2, hi2] = zRangeByColor(result!.group, LAYER_2_GREY)
    expect(lo1).toBeCloseTo(hi2, 6)
    expect(lo2).toBeCloseTo(0, 6)
    expect(hi1).toBeCloseTo(2, 6)
  })

  it("puts layer 1 at the bottom when reverseLayers is true (mirrored stack)", () => {
    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness: 1,
      reverseLayers: true,
    })
    expect(result).not.toBeNull()
    const [lo1, hi1] = zRangeByColor(result!.group, LAYER_1_GREY)
    const [lo2] = zRangeByColor(result!.group, LAYER_2_GREY)
    expect(lo2).toBeCloseTo(hi1, 6)
    expect(lo1).toBeCloseTo(0, 6)
  })

  it("merges all tile-meshed layers into one mesh with one material", () => {
    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness: 1,
      reverseLayers: false,
    })
    const meshes = layerMeshes(result!.group)
    expect(meshes).toHaveLength(1)
    expect(result!.layerInfo.map((l) => [l.layerId, l.mode])).toEqual([
      [2, "tiles"],
      [1, "tiles"],
    ])
  })

  it("scales z by thickness / mmPerUnit and updates it without a rebuild", () => {
    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView: { ...canvasView, mmPerUnit: 2 },
      layerThickness: 1,
      reverseLayers: false,
    })!
    expect(zRangeByColor(result.group, LAYER_1_GREY)[1]).toBeCloseTo(1, 6)
    updateLayerThickness(result.group, 3, 2)
    expect(zRangeByColor(result.group, LAYER_1_GREY)[1]).toBeCloseTo(3, 6)
  })

  it("puts fallback layers in the same stack and coordinates", () => {
    // A cutout on the outline forces layer 1 onto the legacy path
    const withCutout: Layer = {
      ...makeLayer(1, ["2,2", "3,2"]),
      pointModifications: new Map([
        ["2,2", { cutouts: [{ anchor: "w" as const, diameterMm: 0.5 }] }],
      ]),
    }
    const result = createLayeredModel({
      layers: [withCutout, makeLayer(2, ["2,2", "3,2"])],
      exportRect,
      canvasView,
      layerThickness: 1,
      reverseLayers: false,
    })!
    expect(result.layerInfo.map((l) => l.mode)).toEqual(["tiles", "fallback"])
    expect(layerMeshes(result.group)).toHaveLength(2)
    const [lo1, hi1] = zRangeByColor(result.group, LAYER_1_GREY)
    expect([lo1, hi1]).toEqual([1, 2])
    // Same footprint position as the tile-meshed layer below it
    const box = (hex: number) => {
      const target = new THREE.Color(hex)
      const b = new THREE.Box3()
      for (const mesh of layerMeshes(result.group)) {
        const pos = mesh.geometry.attributes.position
        const col = mesh.geometry.attributes.color
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(col.getX(i) - target.r) < 1e-6) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i))
        }
      }
      return b
    }
    const b1 = box(LAYER_1_GREY)
    const b2 = box(LAYER_2_GREY)
    expect(b1.min.x).toBeCloseTo(b2.min.x, 3)
    expect(b1.max.y).toBeCloseTo(b2.max.y, 3)
  })
})
