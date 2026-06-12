/**
 * STL Export
 *
 * Builds a 3D model from the layer stack (same pipeline as the 3D preview) and
 * exports it as a binary STL file.
 *
 * Each visible layer is extruded to `layerThickness` mm and stacked along the
 * Z-axis. Layers are output in real mm units (not the scaled scene units used
 * by the Three.js preview).
 *
 * The STLExporter produces a binary STL, which is smaller and more broadly
 * supported than ASCII STL.
 */

import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
import { createLayeredModel, type LayerThickness } from "@/lib/threejs"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

export interface ExportStlOptions {
  layers: Layer[]
  exportRect: ExportRect
  canvasView: CanvasViewState
  layerThickness: LayerThickness
  reverseLayers: boolean
  /** When false, cutout holes are omitted from the extruded geometry. Defaults to true. */
  includeCutouts?: boolean
  /** Base filename (without extension). Defaults to "model". */
  fileName?: string
}

/**
 * Generate a 3D model from the layer stack and trigger a binary STL download.
 *
 * The geometry is built in real mm units so the STL is correctly scaled for
 * slicers without requiring any import-time unit conversion.
 *
 * Returns false if no geometry could be produced (e.g. all layers empty).
 */
export function exportStl(options: ExportStlOptions): boolean {
  const {
    layers,
    exportRect,
    canvasView,
    layerThickness,
    reverseLayers,
    includeCutouts = true,
    fileName = "model",
  } = options

  // createLayeredModel works in scene units (1 / mmPerUnit scale). We need
  // real mm for the STL, so we temporarily override mmPerUnit to 1, which
  // makes the scene-unit scale factor 1 — geometry is then produced in mm.
  const mmPerUnitForStl = 1
  const scaledCanvasView: CanvasViewState = {
    ...canvasView,
    mmPerUnit: mmPerUnitForStl,
  }
  const scaledExportRect: ExportRect = {
    ...exportRect,
    customMmPerUnit: mmPerUnitForStl,
  }

  const effectiveMmPerUnit =
    exportRect.customMmPerUnit && exportRect.customMmPerUnit > 0
      ? exportRect.customMmPerUnit
      : canvasView.mmPerUnit

  // The SVG content generated internally uses subgrid coordinates, which are
  // already in physical mm via mmPerUnit. We scale the geometry post-hoc so
  // that 1 scene unit = 1 mm in the output STL.
  const result = createLayeredModel({
    layers,
    exportRect: scaledExportRect,
    canvasView: scaledCanvasView,
    layerThickness,
    reverseLayers,
    includeCutouts,
  })

  if (!result) return false

  // Re-scale from subgrid units to mm. The SVG paths are generated in subgrid
  // units (each grid cell = 1 unit), so we scale the whole group by
  // effectiveMmPerUnit to get real mm.
  result.group.scale.set(effectiveMmPerUnit, effectiveMmPerUnit, 1)
  // Z is already in mm (layerThickness is always specified in mm and the
  // scale factor for Z in createLayeredModel is 1/mmPerUnit * mmPerUnit = 1
  // when mmPerUnit=1), so no Z scale needed.

  // Force matrix update so the exporter sees the scaled vertices.
  result.group.updateMatrixWorld(true)

  const exporter = new STLExporter()
  const stlBuffer = exporter.parse(result.group, { binary: true }) as DataView

  const blob = new Blob([stlBuffer], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${fileName}.stl`
  a.click()
  URL.revokeObjectURL(url)

  // Dispose geometry and materials to avoid memory leaks.
  result.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose())
      } else {
        obj.material.dispose()
      }
    }
  })

  return true
}
