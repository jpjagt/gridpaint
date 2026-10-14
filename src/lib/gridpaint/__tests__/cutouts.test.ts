import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { generateLayerDxfEntities } from "@/lib/blob-engine/renderers/DxfRenderer"
import { describe, expect, it } from "vitest"
import { generateLayerSvgContent } from "@/lib/export/svgUtils"
import { classifySvgLoops, createExtrudeGeometryFromSvg } from "@/lib/threejs/pathToShape"
import { meshVolume, nonManifoldEdgeCount } from "@/lib/test-utils/geometryTestUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { Cutout } from "@/types/gridpaint"

const points = new Set<string>()
for (let x = -3; x <= 6; x++) {
  for (let y = -3; y <= 6; y++) points.add(`${x},${y}`)
}

function svg(cutout: Cutout, mmPerUnit: number) {
  const layer: GridLayer = {
    id: 1, groups: [{ id: "default", points }], isVisible: true, renderStyle: "default",
    pointModifications: new Map([["0,0", { cutouts: [cutout] }]]),
  }
  return `<svg xmlns="http://www.w3.org/2000/svg">${generateLayerSvgContent(
    layer, 50, 0, { fillColor: "#000", includeCutouts: true }, mmPerUnit,
  )}</svg>`
}

function holeBounds(source: string) {
  const shapes = classifySvgLoops(source)!
  expect(shapes).toHaveLength(1)
  expect(shapes[0].holes).toHaveLength(1)
  const pts = shapes[0].holes[0]
  return {
    width: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)),
    height: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)),
  }
}

describe("cutout rendering and physical scale", () => {
  it("keeps legacy millimeter circles physically fixed at either export scale", () => {
    for (const scale of [2, 5]) {
      const bounds = holeBounds(svg({ anchor: "center", diameterMm: 2 }, scale))
      expect(bounds.width * scale).toBeCloseTo(2, 2)
      expect(bounds.height * scale).toBeCloseTo(2, 2)
    }
  })

  it("keeps grid-sized circles relative to the grid when the export scale changes", () => {
    const cutout = { anchor: "center", diameterMm: 2, sizeUnit: "grid", diameterGrid: 0.5 } as Cutout
    for (const scale of [2, 5]) {
      const bounds = holeBounds(svg(cutout, scale))
      expect(bounds.width).toBeCloseTo(0.5, 2)
      expect(bounds.height).toBeCloseTo(0.5, 2)
    }
  })

  it("joins pill endpoint circles with tangent sides and extrudes a watertight hole", () => {
    const pill = {
      anchor: "center", diameterMm: 2, shape: "pill", endOffset: { x: 3, y: 0 },
    } as Cutout
    const source = svg(pill, 2)
    const bounds = holeBounds(source)
    expect(bounds.width).toBeCloseTo(4, 2)
    expect(bounds.height).toBeCloseTo(1, 2)
    const pillMesh = createExtrudeGeometryFromSvg(source, {}, 1)!
    const circleMesh = createExtrudeGeometryFromSvg(svg({ anchor: "center", diameterMm: 2 }, 2), {}, 1)!
    // A 3-unit segment and a 1-unit diameter add exactly 3 square units of hole.
    expect(meshVolume(circleMesh) - meshVolume(pillMesh)).toBeCloseTo(3, 2)
    expect(nonManifoldEdgeCount(pillMesh)).toBe(0)
    pillMesh.dispose()
    circleMesh.dispose()
  })

  it("renders coincident pill endpoints as a circle", () => {
    const cutout = {
      anchor: "center", diameterMm: 2, shape: "pill", endOffset: { x: 0, y: 0 },
    } as Cutout
    expect(holeBounds(svg(cutout, 2))).toEqual(holeBounds(svg({ anchor: "center", diameterMm: 2 }, 2)))
  })
})


describe("DXF cutouts", () => {
  it.each([2, 5])("exports pill width and endpoint spacing using scale %s", (scale) => {
    const layer: GridLayer = {
      id: 1, groups: [{ id: "default", points }], isVisible: true, renderStyle: "default",
      pointModifications: new Map([["0,0", { cutouts: [{
        anchor: "center", shape: "pill", endOffset: { x: 3, y: 0 },
        sizeUnit: "grid", diameterGrid: 0.5, diameterMm: 2,
      }] }]]),
    }
    const geometry = new BlobEngine().generateLayerGeometry(layer, 50)
    const result = generateLayerDxfEntities(geometry, layer, scale)!
    const entity = result.entities.find(e => e.includes("8\nCUTOUTS"))!
    const vertices = [...entity.matchAll(/0\nVERTEX\n8\nCUTOUTS\n10\n([^\n]+)\n20\n([^\n]+)/g)]
    const xs = vertices.map(v => Number(v[1]))
    const ys = vertices.map(v => Number(v[2]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.5 * scale, 2)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.5 * scale, 2)
  })
})

describe("cutout editing geometry", () => {
  it("uses both clicked anchors, including custom fractional offsets", async () => {
    const { finishPillCutout } = await import("@/lib/gridpaint/cutoutUtils")
    const { getCutoutGeometry, cutoutContainsPoint } = await import("@/lib/gridpaint/cutoutGeometry")
    const first: Cutout = { anchor: "nw", diameterMm: 2 }
    const second: Cutout = { anchor: "custom", customOffset: { x: 0.25, y: -0.25 }, diameterMm: 2 }
    const pill = finishPillCutout(first, { x: 2, y: 3 }, second, { x: 5, y: 6 })
    expect(pill.endOffset).toEqual({ x: 3.75, y: 3.25 })
    const geometry = getCutoutGeometry(pill, 2, 3, 2)
    expect(geometry.start).toEqual({ x: 1.5, y: 2.5 })
    expect(geometry.end).toEqual({ x: 5.25, y: 5.75 })
    expect(cutoutContainsPoint(geometry, 3.375, 4.125)).toBe(true)
    expect(cutoutContainsPoint(geometry, 1.5, 5.75)).toBe(false)
    expect(cutoutContainsPoint(geometry, 5.5, 6)).toBe(true)
  })

  it("distinguishes stored sizing modes and distinct pill endpoints when detecting duplicates", async () => {
    const { isDuplicateCutout } = await import("@/lib/gridpaint/cutoutUtils")
    const pill: Cutout = { shape: "pill", anchor: "center", diameterMm: 2, endOffset: { x: 3, y: 0 } }
    expect(isDuplicateCutout([pill], { ...pill })).toBe(true)
    expect(isDuplicateCutout([pill], { ...pill, endOffset: { x: 0, y: 3 } })).toBe(false)
    expect(isDuplicateCutout([pill], { ...pill, sizeUnit: "grid", diameterGrid: 2 })).toBe(false)
  })

  it("scales rivet widths without moving pill endpoints", async () => {
    const { createRivetCutouts } = await import("@/lib/gridpaint/cutoutUtils")
    const layers = [1, 2, 3].map(id => ({
      id, isVisible: true, renderStyle: "default" as const,
      groups: [{ id: "default", points: new Set(["0,0"]) }],
    }))
    const pill: Cutout = {
      shape: "pill", anchor: "center", diameterMm: 2, sizeUnit: "grid", diameterGrid: 0.5,
      endOffset: { x: 3, y: -2 },
    }
    const cutouts = createRivetCutouts("0,0", pill, 140, layers)
    expect([...cutouts.values()].map(c => c.diameterGrid)).toEqual([0.7, 0.5, 0.7])
    for (const cutout of cutouts.values()) expect(cutout.endOffset).toEqual({ x: 3, y: -2 })
  })
})

describe("export rectangle scale overrides", () => {
  it.each([
    { sizeUnit: "mm" as const, customMmPerUnit: undefined, widthMm: 17, heightMm: 2 },
    { sizeUnit: "mm" as const, customMmPerUnit: 2, widthMm: 8, heightMm: 2 },
    { sizeUnit: "grid" as const, customMmPerUnit: undefined, widthMm: 17.5, heightMm: 2.5 },
    { sizeUnit: "grid" as const, customMmPerUnit: 2, widthMm: 7, heightMm: 1 },
  ])("resolves $sizeUnit pills with override $customMmPerUnit in SVG, DXF and 3D", async fixture => {
    const { buildSvgFiles } = await import("@/lib/export/exportRectsSvg")
    const { buildDxfFiles } = await import("@/lib/export/exportRectsDxf")
    const { createLayeredModel } = await import("@/lib/threejs/LayeredModel")
    const { $canvasView } = await import("@/stores/drawingStores")
    const { Mesh } = await import("three")
    const layer = {
      id: 1, groups: [{ id: "default", points }], isVisible: true, renderStyle: "default" as const,
      pointModifications: new Map([["0,0", { cutouts: [{
        anchor: "center" as const, shape: "pill" as const, endOffset: { x: 3, y: 0 },
        sizeUnit: fixture.sizeUnit, diameterGrid: 0.5, diameterMm: 2,
      }] }]]),
    }
    const rect = { id: "test", minX: -3, minY: -3, maxX: 6, maxY: 6, quantity: 1,
      customMmPerUnit: fixture.customMmPerUnit }
    const scale = fixture.customMmPerUnit ?? 5
    const svgFile = buildSvgFiles([rect], [layer], 50, 0, "test", 5)[0]
    const bounds = holeBounds(svgFile.content)
    expect(bounds.width * scale).toBeCloseTo(fixture.widthMm, 1)
    expect(bounds.height * scale).toBeCloseTo(fixture.heightMm, 1)
    const dxf = buildDxfFiles([rect], [layer], 50, 0, "test", 5)[0].content
    const vertices = [...dxf.matchAll(/0\nVERTEX\n8\nCUTOUTS\n10\n([^\n]+)\n20\n([^\n]+)/g)]
    const xs = vertices.map(v => Number(v[1]))
    const ys = vertices.map(v => Number(v[2]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(fixture.widthMm, 2)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(fixture.heightMm, 2)

    const options = {
      layers: [layer], exportRect: rect, canvasView: { ...$canvasView.get(), mmPerUnit: 5 },
      layerThickness: 1 as const, reverseLayers: false,
    }
    const solid = createLayeredModel({ ...options, includeCutouts: false })!
    const holed = createLayeredModel(options)!
    const firstMesh = (root: typeof solid.group) => {
      let found: InstanceType<typeof Mesh> | undefined
      root.traverse(o => { if (!found && o instanceof Mesh) found = o })
      return found!
    }
    const solidMesh = firstMesh(solid.group)
    const holeMesh = firstMesh(holed.group)
    // Geometry is built one unit thick per layer; thickness is the stack's z-scale
    const worldVolume = (mesh: InstanceType<typeof Mesh>) => meshVolume(mesh.geometry) * mesh.parent!.scale.z
    const removedVolumeMm = (worldVolume(solidMesh) - worldVolume(holeMesh)) * scale ** 3
    // Physical volume of a pill: diameter * center distance + two semicircles, at 1 mm thick.
    const expectedVolume = fixture.heightMm * 3 * scale + Math.PI * (fixture.heightMm / 2) ** 2
    expect(Math.abs(removedVolumeMm - expectedVolume) / expectedVolume).toBeLessThan(0.005)
    solidMesh.geometry.dispose()
    holeMesh.geometry.dispose()
  })
})
