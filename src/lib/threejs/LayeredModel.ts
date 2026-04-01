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

export type LayerThickness = 0.5 | 1 | 1.5

export const LAYER_THICKNESS_OPTIONS: LayerThickness[] = [0.5, 1, 1.5]

export interface LayeredModelOptions {
  layers: Layer[]
  exportRect: ExportRect
  canvasView: CanvasViewState
  layerThickness: LayerThickness
  reverseLayers: boolean
}

export interface LayeredModelResult {
  group: THREE.Group
  boundingBox: THREE.Box3
  layerCount: number
}

export function createLayeredModel(
  options: LayeredModelOptions,
): LayeredModelResult | null {
  const { layers, exportRect, canvasView, layerThickness, reverseLayers } =
    options
  const { gridSize, borderWidth, mmPerUnit } = canvasView

  const effectiveMmPerUnit =
    exportRect.customMmPerUnit && exportRect.customMmPerUnit > 0
      ? exportRect.customMmPerUnit
      : mmPerUnit

  const visibleLayers = layers.filter((l) => l.isVisible)

  if (visibleLayers.length === 0) return null

  const clippedLayers = clipLayersToSelection(visibleLayers, exportRect)

  if (clippedLayers.length === 0) return null

  let sortedLayers = [...clippedLayers].sort((a, b) => a.id - b.id)
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
      { strokeColor: "#000", strokeWidth: 0.1, fillColor: "transparent" },
      effectiveMmPerUnit,
    )

    if (!svgContent || svgContent.trim() === "") continue

    const geometry = createExtrudeGeometryFromSvg(
      svgContent,
      { offsetX: 0, offsetY: 0 },
      scaledThickness,
    )

    if (!geometry) continue

    const material = new THREE.MeshStandardMaterial({
      color: getLayerGrey(layer.id),
      roughness: 0.2,
      metalness: 0.8,
      envMapIntensity: 0.9,
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
    console.log({ currentZ, scaledThickness })
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
