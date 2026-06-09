import { describe, it, expect } from "vitest"
import { serializeDocument, deserializeDocument } from "@/lib/storage/serialization"
import type { DrawingDocument } from "@/lib/storage/types"

function baseDoc(overrides: Partial<DrawingDocument> = {}): DrawingDocument {
  return {
    id: "d1", name: "Test", createdAt: 1000, updatedAt: 2000,
    gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
    layers: [
      { id: 1, isVisible: true, renderStyle: "default",
        groups: [{ id: "default", points: new Set(["0,0", "1,1"]) }] },
    ],
    ...overrides,
  }
}

describe("serialization round-trip", () => {
  it("preserves a basic document through serialize -> deserialize", () => {
    const round = deserializeDocument(serializeDocument(baseDoc()))
    expect(round.id).toBe("d1")
    expect(round.layers[0].groups[0].points).toEqual(new Set(["0,0", "1,1"]))
  })
  it("serializes groups Set to array and back", () => {
    const ser = serializeDocument(baseDoc())
    expect(ser.layers[0].groups![0].points).toEqual(["0,0", "1,1"])
  })
  it("migrates legacy flat points to a default group", () => {
    const legacy = { ...serializeDocument(baseDoc()),
      layers: [{ id: 1, isVisible: true, renderStyle: "default" as const, points: ["2,2", "3,3"] }] }
    const round = deserializeDocument(legacy)
    expect(round.layers[0].groups[0].id).toBe("default")
    expect(round.layers[0].groups[0].points).toEqual(new Set(["2,2", "3,3"]))
  })
  it("migrates cutout radius (v1, grid units) to diameterMm", () => {
    const ser = serializeDocument(baseDoc({ mmPerUnit: 5 }))
    ser.layers[0].pointModifications = { "0,0": { cutouts: [{ radius: 2 } as never] } }
    const round = deserializeDocument(ser)
    const cutout = round.layers[0].pointModifications!.get("0,0")!.cutouts![0]
    expect((cutout as { diameterMm: number }).diameterMm).toBe(20)
  })
  it("migrates cutout radiusMm (v2) to diameterMm (v3)", () => {
    const ser = serializeDocument(baseDoc())
    ser.layers[0].pointModifications = { "0,0": { cutouts: [{ radiusMm: 5 } as never] } }
    const round = deserializeDocument(ser)
    const cutout = round.layers[0].pointModifications!.get("0,0")!.cutouts![0]
    expect((cutout as { diameterMm: number }).diameterMm).toBe(10)
  })
})
