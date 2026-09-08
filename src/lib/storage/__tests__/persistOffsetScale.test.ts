import { describe, it, expect } from "vitest"
import {
  serializeDocument,
  deserializeDocument,
} from "@/lib/storage/serialization"
import type { DrawingDocument } from "@/lib/storage/types"

function makeDoc(): DrawingDocument {
  return {
    id: "test-1",
    name: "t",
    createdAt: 0,
    updatedAt: 0,
    gridSize: 10,
    borderWidth: 0,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [
      {
        id: 1,
        isVisible: true,
        renderStyle: "default",
        groups: [
          { id: "n", points: new Set(["0,0"]) },
          { id: "h", points: new Set(["1,1"]), offsetPhaseX: "half", offsetPhaseY: "normal" },
        ],
        scale: { num: 1, den: 2 },
      },
    ],
  }
}

// Round-trips through the shared (de)serialization helpers used by both the
// LocalStorage (IndexedDB) and Firestore stores. Testing the pure functions
// directly avoids needing an IndexedDB polyfill in the test environment.
describe("persist offset phases + scale", () => {
  it("round-trips per-axis offset phases and scale through serialize/deserialize", () => {
    const loaded = deserializeDocument(serializeDocument(makeDoc()))
    const layer = loaded.layers[0]
    expect(layer.scale).toEqual({ num: 1, den: 2 })
    const h = layer.groups.find((g) => g.id === "h")!
    expect(h.offsetPhaseX).toBe("half")
    expect(h.offsetPhaseY).toBe("normal")
    const n = layer.groups.find((g) => g.id === "n")!
    expect(n.offsetPhaseX).toBeUndefined()
    expect(n.offsetPhaseY).toBeUndefined()
  })

  it("loads a legacy doc without the fields as defaults", () => {
    const legacy = makeDoc()
    delete legacy.layers[0].scale
    legacy.layers[0].groups.forEach((g) => {
      delete g.offsetPhaseX
      delete g.offsetPhaseY
    })
    const loaded = deserializeDocument(serializeDocument(legacy))
    expect(loaded.layers[0].scale).toBeUndefined()
    expect(loaded.layers[0].groups[0].offsetPhaseX).toBeUndefined()
    expect(loaded.layers[0].groups[0].offsetPhaseY).toBeUndefined()
  })

  it("does not write offset phase / scale keys when absent (serialized output)", () => {
    const legacy = makeDoc()
    delete legacy.layers[0].scale
    legacy.layers[0].groups.forEach((g) => {
      delete g.offsetPhaseX
      delete g.offsetPhaseY
    })
    const serialized = serializeDocument(legacy)
    const layer = serialized.layers[0]
    expect("scale" in layer).toBe(false)
    expect("offsetPhaseX" in layer.groups![0]).toBe(false)
    expect("offsetPhaseY" in layer.groups![0]).toBe(false)
  })
})
