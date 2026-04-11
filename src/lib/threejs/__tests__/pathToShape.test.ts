/**
 * Tests for createExtrudeGeometryFromSvg — the 3D extrusion pipeline.
 *
 * Key regression: complex layers with non-convex inner holes (e.g. a large
 * U-shaped void in a chain-gear-like pattern) must produce valid
 * BufferGeometry without null/degenerate results. The previous implementation
 * used ray-cast containment + manual Three.js hole assignment, which failed
 * for non-convex holes because earcut triangulation can't handle them reliably.
 * The new implementation uses SVGLoader's even-odd fill rule (compound path
 * with fill-rule="evenodd") which handles arbitrary non-convex holes correctly.
 */

import { describe, it, expect } from "vitest"
import { generateLayerSvgContent } from "@/lib/export/svgUtils"
import { createExtrudeGeometryFromSvg } from "@/lib/threejs/pathToShape"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { PointModifications } from "@/types/gridpaint"

const GRID_SIZE = 50
const BORDER_WIDTH = 2

// Layer 2 of the complex chain-gear shape from the bug report.
// This layer has a large U-shaped non-convex inner void plus a small
// bottom-left void and a small circle on the right — all as holes.
const LAYER2: GridLayer = {
  id: 2,
  isVisible: true,
  renderStyle: "default",
  groups: [
    {
      id: "default",
      points: new Set([
        "130,15","130,16","130,17","131,14","131,16","131,18",
        "132,14","132,18","133,15","133,17","134,14","134,18",
        "135,15","135,17","136,14","136,18","137,14","137,16","137,18",
        "138,15","138,17","139,16",
      ]),
    },
    { id: "group-2", points: new Set(["131,16","132,16","133,16","134,16"]) },
  ],
  pointModifications: new Map<string, PointModifications>([
    ["130,15", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
    ["130,17", { cutouts: [{ anchor: "center", diameterMm: 0.9 }] }],
  ]),
}

// Simple solid donut: outer ring with a hole
const DONUT_LAYER: GridLayer = {
  id: 1, isVisible: true, renderStyle: "default",
  groups: [{
    id: "default", points: new Set([
      "5,5","6,5","7,5",
      "5,6",       "7,6",
      "5,7","6,7","7,7",
    ]),
  }],
}

// Two disconnected blobs (no holes)
const TWO_BLOBS_LAYER: GridLayer = {
  id: 1, isVisible: true, renderStyle: "default",
  groups: [{ id: "default", points: new Set(["1,1","2,1","10,10","11,10"]) }],
}

function svgForLayer(layer: GridLayer): string {
  const content = generateLayerSvgContent(
    layer, GRID_SIZE, BORDER_WIDTH,
    { strokeColor: "#000", strokeWidth: 0.1, fillColor: "transparent", includeCutouts: true },
    1.0,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50">
${content}
</svg>`
}

describe("createExtrudeGeometryFromSvg", () => {
  it("produces non-null geometry for complex layer with non-convex holes", () => {
    const svg = svgForLayer(LAYER2)
    const geo = createExtrudeGeometryFromSvg(svg, {}, 1)
    expect(geo).not.toBeNull()
    // Geometry should have vertices
    expect(geo!.attributes.position.count).toBeGreaterThan(0)
  })

  it("produces non-null geometry for a simple donut", () => {
    const svg = svgForLayer(DONUT_LAYER)
    const geo = createExtrudeGeometryFromSvg(svg, {}, 1)
    expect(geo).not.toBeNull()
    expect(geo!.attributes.position.count).toBeGreaterThan(0)
  })

  it("produces non-null geometry for two disconnected blobs", () => {
    const svg = svgForLayer(TWO_BLOBS_LAYER)
    const geo = createExtrudeGeometryFromSvg(svg, {}, 1)
    expect(geo).not.toBeNull()
    expect(geo!.attributes.position.count).toBeGreaterThan(0)
  })

  it("returns null for empty SVG", () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
</svg>`
    const geo = createExtrudeGeometryFromSvg(svg, {}, 1)
    expect(geo).toBeNull()
  })
})
