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
import { createLayeredModel } from "@/lib/threejs/LayeredModel"
import { DEFAULT_LAYER_RANGE } from "@/types/layers"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

// Per-layer grey tints from LayeredModel's getLayerGrey — used to identify
// which mesh belongs to which layer.
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

function meshColors(group: THREE.Group): number[] {
  return group.children
    .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    .map((m) => (m.material as THREE.MeshPhysicalMaterial).color.getHex())
}

function meshZByColor(group: THREE.Group, color: number): number {
  const mesh = group.children
    .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    .find((m) => (m.material as THREE.MeshPhysicalMaterial).color.getHex() === color)
  expect(mesh).toBeDefined()
  return mesh!.position.z
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
    const z1 = meshZByColor(result!.group, LAYER_1_GREY)
    const z2 = meshZByColor(result!.group, LAYER_2_GREY)
    expect(z1).toBeGreaterThan(z2)
    expect(z2).toBe(0)
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
    const z1 = meshZByColor(result!.group, LAYER_1_GREY)
    const z2 = meshZByColor(result!.group, LAYER_2_GREY)
    expect(z2).toBeGreaterThan(z1)
    expect(z1).toBe(0)
  })

  it("renders one mesh per visible layer", () => {
    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness: 1,
      reverseLayers: false,
    })
    expect(meshColors(result!.group).sort()).toEqual(
      [LAYER_1_GREY, LAYER_2_GREY].sort(),
    )
  })
})
