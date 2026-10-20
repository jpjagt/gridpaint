/**
 * LayeredModel - Creates a 3D model from multiple grid layers.
 *
 * Stacks visible layers with configurable thickness, aligned by X/Y position.
 * Layers are meshed directly from their blob pieces by the tile mesher
 * (blobPieces.ts + tileMesher.ts) into one merged geometry. Layers using
 * something the mesher can't represent exactly fall back to the original
 * SVG → ExtrudeGeometry path (see planLayerMesh for the reasons).
 *
 * Geometry is built with every layer one unit thick (layer k spans
 * z ∈ [k, k + 1]); the actual thickness is a z-scale on the inner stack
 * group, so changing it needs no rebuild (see updateLayerThickness).
 */

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { clipLayersToSelection } from "@/lib/gridpaint/selectionUtils"
import {
  convertLayerToGridLayer,
  generateLayerSvgContent,
} from "@/lib/export/svgUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
import { createExtrudeGeometryFromSvg } from "./pathToShape"
import { planLayerMesh } from "./blobPieces"
import { TileMeshBuilder } from "./tileMesher"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type { LayeredModelLayerInfo, LayerMeshPlan } from "@/types/threejs"
import { resolveRectMmPerUnit } from "@/lib/export/rectSettings"
import { LAYER_THICKNESS_PRESETS } from "@/lib/constants"

/** Layer thickness in mm. Any positive value; presets below are shortcuts. */
export type LayerThickness = number

export const LAYER_THICKNESS_OPTIONS: LayerThickness[] = LAYER_THICKNESS_PRESETS

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
  layerInfo: LayeredModelLayerInfo[]
}

const STACK_NAME = "layered-model-stack"

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

  const effectiveMmPerUnit = resolveRectMmPerUnit(exportRect, mmPerUnit)

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

  const planned = sortedLayers.map((layer) => {
    const gridLayer = convertLayerToGridLayer(layer)
    const plan = planLayerMesh(gridLayer, {
      includeCutouts,
      mmPerUnit: effectiveMmPerUnit,
    })
    return { layer, gridLayer, plan }
  })
  const arcSegments = chooseArcSegments(planned.map((p) => p.plan))

  const builder = new TileMeshBuilder()
  const fallbackGeometries: THREE.BufferGeometry[] = []
  const layerInfo: LayeredModelLayerInfo[] = []
  let slot = 0

  for (const { layer, gridLayer, plan } of planned) {
    const color = new THREE.Color(getLayerGrey(layer.id))
    if (plan.kind === "tiles") {
      builder.addLayer(plan.grid, plan.regions, {
        z0: slot,
        color: [color.r, color.g, color.b],
        scale: scaleToFactor(layer.scale),
        arcSegments,
      })
      layerInfo.push({ layerId: layer.id, slot, mode: "tiles" })
      slot++
    } else if (plan.kind === "fallback") {
      const geometry = createLegacyLayerGeometry(
        gridLayer,
        gridSize,
        borderWidth,
        includeCutouts,
        effectiveMmPerUnit,
      )
      if (!geometry) continue
      geometry.translate(0, 0, slot)
      const count = geometry.attributes.position.count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
      fallbackGeometries.push(geometry)
      layerInfo.push({
        layerId: layer.id,
        slot,
        mode: "fallback",
        fallbackReason: plan.reason,
      })
      slot++
    }
  }

  // Glossy metal ("wet chrome") material ported from the flowers repo.
  // metalness=1 + roughness~0 makes the surface a near-mirror, so the look
  // comes almost entirely from the scene's HDRI environment map (see
  // sceneSetup.ts). Per-layer grey (vertex colour) tints the reflection
  // subtly per layer. One material for the whole model; the meshes are
  // closed solids with outward normals, so back faces can be culled.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 1,
    roughness: 0.12, // slightly softened reflections (was 0.02 mirror)
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.06, // faint clearcoat blur to match
    side: THREE.FrontSide,
  })

  const stack = new THREE.Group()
  stack.name = STACK_NAME
  stack.scale.z = layerThickness / effectiveMmPerUnit

  const linePositions: Float32Array[] = []

  if (!builder.isEmpty) {
    const buffers = builder.finish()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3))
    geometry.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 3))
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = "tile-mesh"
    stack.add(mesh)
    linePositions.push(buffers.lines)
  }

  if (fallbackGeometries.length > 0) {
    const geometry =
      fallbackGeometries.length === 1
        ? fallbackGeometries[0]
        : mergeGeometries(fallbackGeometries, false)
    if (fallbackGeometries.length > 1) fallbackGeometries.forEach((g) => g.dispose())
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = "fallback-mesh"
      stack.add(mesh)
      const edges = new THREE.EdgesGeometry(geometry, 15)
      linePositions.push(edges.attributes.position.array as Float32Array)
      edges.dispose()
    }
  }

  if (linePositions.length > 0) {
    const total = linePositions.reduce((n, a) => n + a.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const a of linePositions) {
      merged.set(a, offset)
      offset += a.length
    }
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(merged, 3))
    const lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0x000000,
        opacity: 0.25,
        transparent: true,
      }),
    )
    lines.name = "edge-lines"
    stack.add(lines)
  }

  const group = new THREE.Group()
  group.add(stack)

  const boundingBox = new THREE.Box3().setFromObject(group)

  return {
    group,
    boundingBox,
    layerCount: sortedLayers.length,
    layerInfo,
  }
}

/**
 * Original pipeline for one layer: SVG paths → shapes → ExtrudeGeometry,
 * one unit deep, in the same y-up scene coordinates as the tile mesher.
 * Used for layers the tile mesher can't represent (see planLayerMesh).
 */
export function createLegacyLayerGeometry(
  gridLayer: GridLayer,
  gridSize: number,
  borderWidth: number,
  includeCutouts: boolean,
  mmPerUnit: number,
): THREE.BufferGeometry | null {
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
    mmPerUnit,
  )

  if (!svgContent || svgContent.trim() === "") return null

  // A zero-height viewBox makes the extruder's y-flip a plain negation, so
  // its output lines up with the tile mesher's coordinates (y_scene = -y).
  const geometry = createExtrudeGeometryFromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0">${svgContent}</svg>`,
    { offsetX: 0, offsetY: 0 },
    1,
  )
  if (!geometry) return null
  geometry.deleteAttribute("uv")
  return geometry
}

/**
 * Segments per quarter arc: 16 (the old extrusion's flattening) for small
 * drawings, fewer for big ones where each arc is only a few pixels on
 * screen. Smooth normals hide the facets either way; this mostly sets how
 * round the silhouette stays when zoomed right in.
 */
function chooseArcSegments(plans: LayerMeshPlan[]): number {
  let extent = 1
  for (const plan of plans) {
    if (plan.kind !== "tiles") continue
    extent = Math.max(extent, plan.grid.width / 2, plan.grid.height / 2)
  }
  return Math.max(6, Math.min(16, Math.round(96 / Math.sqrt(extent))))
}

function getLayerGrey(layerId: number): number {
  const greys = [0xf5f5f5, 0xe8e8e8, 0xdcdcdc, 0xd0d0d0, 0xc4c4c4, 0xb8b8b8]
  return greys[layerId - 1] ?? 0xe8e8e8
}

/**
 * Apply a new layer thickness to a model from createLayeredModel without
 * rebuilding it (thickness is the z-scale of the inner stack).
 */
export function updateLayerThickness(
  group: THREE.Group,
  newThickness: LayerThickness,
  effectiveMmPerUnit: number,
): void {
  const stack = group.getObjectByName(STACK_NAME)
  if (stack) stack.scale.z = newThickness / effectiveMmPerUnit
}
