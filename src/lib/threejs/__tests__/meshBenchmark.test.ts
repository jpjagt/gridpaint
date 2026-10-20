/**
 * Build-time benchmark: legacy SVG → ExtrudeGeometry pipeline vs the tile
 * mesher, for 4 layers of 100×100. Opt-in (slow): run with
 *
 *   BENCH=1 pnpm vitest run src/lib/threejs/__tests__/meshBenchmark.test.ts
 */

import { describe, it } from "vitest"
import * as THREE from "three"
import {
  createLayeredModel,
  createLegacyLayerGeometry,
} from "@/lib/threejs/LayeredModel"
import { convertLayerToGridLayer } from "@/lib/export/svgUtils"
import { DEFAULT_LAYER_RANGE } from "@/types/layers"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

/** Uniform random cells: worst case, thousands of tiny holes and islands */
function whiteNoise(id: number, size: number): Layer {
  const r = rng(id * 7)
  const pts = new Set<string>()
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (r() < 0.5) pts.add(`${x},${y}`)
  return { id, isVisible: true, renderStyle: "default", groups: [{ id: "default", points: pts }] }
}

/** Thresholded value noise: organic blobs, closer to real drawings */
function blobNoise(id: number, size: number, cell = 6): Layer {
  const r = rng(id * 31)
  const gw = Math.ceil(size / cell) + 2
  const g = Array.from({ length: gw * gw }, () => r())
  const s = (t: number) => t * t * (3 - 2 * t)
  const pts = new Set<string>()
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / cell, fy = y / cell
      const ix = Math.floor(fx), iy = Math.floor(fy)
      const tx = s(fx - ix), ty = s(fy - iy)
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1]
      const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1]
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
      if (v > 0.45) pts.add(`${x},${y}`)
    }
  return { id, isVisible: true, renderStyle: "default", groups: [{ id: "default", points: pts }] }
}

const canvasView: CanvasViewState = {
  gridSize: 50,
  borderWidth: 2,
  panOffset: { x: 0, y: 0 },
  zoom: 1,
  mmPerUnit: 1,
  layerThickness: 1,
  layerRange: DEFAULT_LAYER_RANGE,
}
const exportRect = { id: "r", minX: 0, minY: 0, maxX: 99, maxY: 99, quantity: 1 }

function time<T>(fn: () => T): [T, number] {
  const t = performance.now()
  const out = fn()
  return [out, performance.now() - t]
}

/** The pre-tile-mesher createLayeredModel work: extrude + edges per layer */
function legacyBuild(layers: Layer[]): number {
  let triangles = 0
  for (const layer of layers) {
    const geo = createLegacyLayerGeometry(convertLayerToGridLayer(layer), 50, 2, true, 1)
    if (!geo) continue
    new THREE.EdgesGeometry(geo, 15).dispose()
    triangles += geo.attributes.position.count / 3
    geo.dispose()
  }
  return triangles
}

function tileTriangles(group: THREE.Group): number {
  let n = 0
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) n += (o.geometry.index?.count ?? 0) / 3
  })
  return n
}

describe.skipIf(!process.env.BENCH)("3D preview build time", () => {
  for (const [name, make] of [
    ["white noise", whiteNoise],
    ["blob noise", blobNoise],
  ] as const) {
    it(`4 layers 100×100, ${name}`, () => {
      const layers = [1, 2, 3, 4].map((id) => make(id, 100))
      const [legacyTris, legacyMs] = time(() => legacyBuild(layers))
      // Warm-up, then best of 3
      createLayeredModel({ layers, exportRect, canvasView, layerThickness: 1, reverseLayers: false })
      let best = Infinity
      let result = null
      for (let k = 0; k < 3; k++) {
        const [r, ms] = time(() =>
          createLayeredModel({ layers, exportRect, canvasView, layerThickness: 1, reverseLayers: false }),
        )
        best = Math.min(best, ms)
        result = r
      }
      console.log(
        `[bench] ${name}: legacy ${legacyMs.toFixed(0)} ms (${legacyTris.toFixed(0)} tris) → ` +
          `tile mesher ${best.toFixed(1)} ms (${tileTriangles(result!.group).toFixed(0)} tris), ` +
          `${(legacyMs / best).toFixed(0)}× faster`,
      )
    }, 600000)
  }
})
