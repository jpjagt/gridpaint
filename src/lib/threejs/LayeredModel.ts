/**
 * LayeredModel - Creates a 3D model from multiple grid layers using SVG content.
 *
 * Stacks visible layers with configurable thickness, aligned by X/Y position.
 */

import * as THREE from "three"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import {
  convertLayerToGridLayer,
  generateLayerSvgContent,
} from "@/lib/export/svgUtils"
import { createExtrudeGeometryFromSvg } from "./pathToShape"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

/** Layer thickness in mm. Any positive value; presets below are shortcuts. */
export type LayerThickness = number

export const LAYER_THICKNESS_OPTIONS: LayerThickness[] = [0.5, 1, 1.5, 2.0]

export interface LayeredModelOptions {
  layers: Layer[]
  exportRect: ExportRect
  canvasView: CanvasViewState
  layerThickness: LayerThickness
  reverseLayers: boolean
  /** When false, cutout holes are omitted from the extruded geometry. Defaults to true. */
  includeCutouts?: boolean
}

export interface LayeredModelResult {
  group: THREE.Group
  boundingBox: THREE.Box3
  layerCount: number
}

export function createLayeredModel(
  options: LayeredModelOptions,
): LayeredModelResult | null {
  const {
    layers,
    exportRect,
    canvasView,
    layerThickness,
    reverseLayers,
    includeCutouts = true,
  } = options
  const { gridSize, borderWidth, mmPerUnit } = canvasView

  const effectiveMmPerUnit =
    exportRect.customMmPerUnit && exportRect.customMmPerUnit > 0
      ? exportRect.customMmPerUnit
      : mmPerUnit

  const visibleLayers = layers.filter((l) => l.isVisible)

  if (visibleLayers.length === 0) return null

  const clippedLayers = clipLayersToSelection(visibleLayers, exportRect)

  if (clippedLayers.length === 0) return null

  // 2D compositing is bottom-to-top (6→1): layer 1 is the visual top. The
  // camera looks from +Z, so stack descending ids from z=0 upward to put
  // layer 1 nearest the camera and match the drawing; reverseLayers shows
  // the back of the physical stack (the mirrored view) instead.
  let sortedLayers = [...clippedLayers].sort((a, b) => b.id - a.id)
  if (reverseLayers) {
    sortedLayers = sortedLayers.reverse()
  }

  const scale = 1 / effectiveMmPerUnit
  const scaledThickness = layerThickness * scale

  const group = new THREE.Group()
  let currentZ = 0

  for (const layer of sortedLayers) {
    const gridLayer = convertLayerToGridLayer(layer)

    const svgContent = generateLayerSvgContent(
      gridLayer,
      gridSize,
      borderWidth,
      {
        strokeColor: "#000",
        strokeWidth: 0.1,
        fillColor: "transparent",
        includeCutouts,
      },
      effectiveMmPerUnit,
    )

    if (!svgContent || svgContent.trim() === "") continue

    const geometry = createExtrudeGeometryFromSvg(
      svgContent,
      { offsetX: 0, offsetY: 0 },
      scaledThickness,
    )

    if (!geometry) continue

    // Glossy metal ("wet chrome") material ported from the flowers repo.
    // metalness=1 + roughness~0 makes the surface a near-mirror, so the look
    // comes almost entirely from the scene's HDRI environment map (see
    // sceneSetup.ts). Per-layer grey tints the reflection subtly per layer.
    const material = new THREE.MeshPhysicalMaterial({
      color: getLayerGrey(layer.id),
      metalness: 1,
      roughness: 0.12, // slightly softened reflections (was 0.02 mirror)
      envMapIntensity: 1.6,
      clearcoat: 1,
      clearcoatRoughness: 0.06, // faint clearcoat blur to match
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.z = currentZ

    const edges = new THREE.EdgesGeometry(geometry, 15)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      opacity: 0.25,
      transparent: true,
    })
    const wireframe = new THREE.LineSegments(edges, lineMaterial)
    wireframe.position.z = 0
    mesh.add(wireframe)

    group.add(mesh)

    currentZ += scaledThickness
  }

  const boundingBox = new THREE.Box3().setFromObject(group)

  return {
    group,
    boundingBox,
    layerCount: sortedLayers.length,
  }
}

function getLayerGrey(layerId: number): number {
  const greys = [0xf5f5f5, 0xe8e8e8, 0xdcdcdc, 0xd0d0d0, 0xc4c4c4, 0xb8b8b8]
  return greys[layerId - 1] ?? 0xe8e8e8
}

export function updateLayerThickness(
  group: THREE.Group,
  newThickness: LayerThickness,
  effectiveMmPerUnit: number,
): void {
  const scale = 1 / effectiveMmPerUnit
  const scaledThickness = newThickness * scale
  let currentZ = 0
  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.z = currentZ
      const wireframe = child.children[0]
      if (wireframe instanceof THREE.LineSegments) {
        wireframe.position.z = 0
      }
      currentZ += scaledThickness
    }
  })
}
